/**
 * The parts of AgentCut too heavy to ship in the CLI, fetched the first time they are
 * needed and kept under ~/.agentcut/runtime:
 *
 *   bin/ffmpeg, bin/ffprobe    one platform's static build, from ffmpeg-static's releases
 *   render/<version>/          the prebuilt Remotion bundle and the renderer
 *   studio/<version>/          the visual editor, a standalone Next server
 *
 * A source checkout never downloads anything: it already has every dependency in
 * node_modules, and `IS_CHECKOUT` short-circuits each `ensure*`.
 *
 * Packages come straight from the npm registry's tarballs rather than through `npm
 * install`, for three reasons: a byte-accurate progress bar, an integrity check against
 * the registry's own sha512, and no dependency on which package manager installed the CLI.
 */
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import { IS_CHECKOUT, ROOT, RUNTIME } from "./root";

/** The ffmpeg-static release the checkout's own `ffmpeg-static` dependency downloads. */
export const FFMPEG_RELEASE = "b6.1.1";
const FFMPEG_BASE = process.env.AGENTCUT_FFMPEG_MIRROR || `https://github.com/eugeneware/ffmpeg-static/releases/download/${FFMPEG_RELEASE}`;

/**
 * A component's files travel inside its npm package as one archive, because npm's
 * packer drops every `node_modules` directory and every symlink — and a standalone
 * Next server and a renderer are mostly those. Unpacked in place after the download.
 */
export const PAYLOAD = "payload.tar.gz";

export type Component = "ffmpeg" | "render" | "studio";
export type Progress = { component: Component; label: string; received: number; total: number; done?: boolean };
export type ProgressSink = (progress: Progress) => void;

/** The CLI's version; every downloaded component is pinned to it so the three always match. */
export const VERSION: string = process.env.AGENTCUT_BUILD_VERSION || process.env.AGENTCUT_VERSION || readVersion();

function readVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, IS_CHECKOUT ? "packages/cli/package.json" : "package.json"), "utf8")).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

const exe = (name: string) => (process.platform === "win32" ? `${name}.exe` : name);
export const runtimeBin = (name: "ffmpeg" | "ffprobe") => path.join(RUNTIME, "bin", exe(name));
export const componentDir = (component: "render" | "studio", version = VERSION) => path.join(RUNTIME, component, version);

/* ------------------------------------------------------------------ progress */

const MB = 1024 * 1024;
const formatMb = (bytes: number) => `${(bytes / MB).toFixed(bytes < 10 * MB ? 1 : 0)} MB`;

/**
 * The default sink: a bar on a terminal, a line every 10% anywhere else (the studio's
 * server log, CI). Written to stderr so a command's JSON on stdout stays parseable.
 */
export function terminalProgress(): ProgressSink {
  const tty = process.stderr.isTTY;
  const lastStep = new Map<string, number>();
  return ({ label, received, total, done }) => {
    // A step with no size of its own: unpacking.
    if (!total && !received) {
      if (tty) process.stderr.write(`\r\x1b[2K  ${done ? "✓" : "…"} ${label}${done ? "\n" : ""}`);
      else process.stderr.write(`${done ? "✓" : "…"} ${label}\n`);
      return;
    }
    const ratio = total ? Math.min(1, received / total) : 0;
    const size = total ? `${formatMb(received)} / ${formatMb(total)}` : formatMb(received);
    if (tty) {
      const width = 24, filled = Math.round(ratio * width);
      const bar = "█".repeat(filled) + "░".repeat(width - filled);
      process.stderr.write(`\r\x1b[2K  ${done ? "✓" : "↓"} ${label.padEnd(34)} ${bar}  ${size}${done ? "\n" : ""}`);
      return;
    }
    // Steps 0–10 are the percentages; 11 is "ready", so it is never mistaken for 100%.
    const step = done ? 11 : Math.floor(ratio * 10);
    if (lastStep.get(label) === step) return;
    lastStep.set(label, step);
    process.stderr.write(`${done ? "✓" : "↓"} ${label} ${done ? "ready" : `${step * 10}%`} (${size})\n`);
  };
}

/* ------------------------------------------------------------------ locking */

/**
 * Two processes asking for the same component at once — the studio and a CLI render —
 * must not both write it. A directory is the lock: mkdir is atomic everywhere. A lock
 * older than ten minutes belongs to a process that died mid-download and is taken over.
 */
async function withLock<T>(name: string, work: () => Promise<T>): Promise<T> {
  const lock = path.join(RUNTIME, `.${name}.lock`);
  await fsp.mkdir(RUNTIME, { recursive: true });
  for (;;) {
    try {
      await fsp.mkdir(lock);
      break;
    } catch {
      const age = Date.now() - ((await fsp.stat(lock).catch(() => null))?.mtimeMs ?? 0);
      if (age > 10 * 60_000) { await fsp.rm(lock, { recursive: true, force: true }); continue; }
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  try {
    return await work();
  } finally {
    await fsp.rm(lock, { recursive: true, force: true });
  }
}

/* ------------------------------------------------------------------ download */

async function download(url: string, to: string, component: Component, label: string, onProgress: ProgressSink, sha512?: string) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}) ${url}`);
  const total = Number(res.headers.get("content-length") ?? 0);
  let received = 0;
  const hash = createHash("sha512");
  const body = Readable.fromWeb(res.body as import("node:stream/web").ReadableStream<Uint8Array>);
  body.on("data", (chunk: Buffer) => {
    received += chunk.length;
    hash.update(chunk);
    onProgress({ component, label, received, total });
  });
  await pipeline(body, fs.createWriteStream(to));
  if (sha512 && hash.digest("base64") !== sha512) {
    await fsp.rm(to, { force: true });
    throw new Error(`${label}: the download does not match the registry's checksum`);
  }
  onProgress({ component, label, received, total: total || received, done: true });
}

/* ------------------------------------------------------------------ ffmpeg */

function ffmpegPlatform() {
  const arch = process.arch === "x64" || process.arch === "arm64" || process.arch === "ia32" || process.arch === "arm" ? process.arch : null;
  const platform = ["darwin", "linux", "win32"].includes(process.platform) ? process.platform : null;
  if (!arch || !platform) throw new Error(`No ffmpeg build for ${process.platform}-${process.arch}. Set AGENTCUT_FFMPEG and AGENTCUT_FFPROBE to your own binaries.`);
  return `${platform}-${arch}`;
}

const ffmpegReady = () => fs.existsSync(runtimeBin("ffmpeg")) && fs.existsSync(runtimeBin("ffprobe"));

/** ffmpeg and ffprobe for this machine, about 19 MB each compressed. No-op in a checkout or when overridden. */
export async function ensureFfmpeg(onProgress: ProgressSink = terminalProgress()): Promise<void> {
  if (IS_CHECKOUT || (process.env.AGENTCUT_FFMPEG && process.env.AGENTCUT_FFPROBE) || ffmpegReady()) return;
  await withLock("ffmpeg", async () => {
    if (ffmpegReady()) return;
    const dir = path.dirname(runtimeBin("ffmpeg"));
    await fsp.mkdir(dir, { recursive: true });
    for (const name of ["ffmpeg", "ffprobe"] as const) {
      const gz = path.join(dir, `.${name}.gz.part`), part = path.join(dir, `.${name}.part`);
      await download(`${FFMPEG_BASE}/${name}-${ffmpegPlatform()}.gz`, gz, "ffmpeg", name, onProgress);
      await pipeline(fs.createReadStream(gz), createGunzip(), fs.createWriteStream(part, { mode: 0o755 }));
      await fsp.rm(gz, { force: true });
      await fsp.rename(part, runtimeBin(name));
    }
    await fsp.writeFile(path.join(dir, "VERSION"), `${FFMPEG_RELEASE}\n`);
  });
}

/* ------------------------------------------------------------------ registry packages */

/**
 * The registry npm itself would use for `name`: AGENTCUT_REGISTRY, then npm's own
 * configuration — the environment, the project and user .npmrc, a `@scope:registry`
 * line before a plain `registry` line — then npmjs.
 */
export function registryUrl(name = ""): string {
  const explicit = process.env.AGENTCUT_REGISTRY || process.env.npm_config_registry || process.env.NPM_CONFIG_REGISTRY;
  if (explicit) return explicit.replace(/\/+$/, "");
  const scope = name.startsWith("@") ? name.split("/")[0] : null;
  const userconfig = process.env.npm_config_userconfig || process.env.NPM_CONFIG_USERCONFIG || path.join(os.homedir(), ".npmrc");
  for (const rc of [path.join(process.cwd(), ".npmrc"), userconfig]) {
    const lines = fs.existsSync(/*turbopackIgnore: true*/ rc) ? fs.readFileSync(/*turbopackIgnore: true*/ rc, "utf8").split("\n") : [];
    const value = (key: string) => lines.find((l) => new RegExp(`^\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*=`).test(l))?.split("=").slice(1).join("=").trim();
    const found = (scope && value(`${scope}:registry`)) || value("registry");
    if (found) return found.replace(/\/+$/, "");
  }
  return "https://registry.npmjs.org";
}

type Dist = { tarball: string; integrity?: string; unpackedSize?: number };

async function packageDist(name: string, version: string): Promise<Dist> {
  const url = `${registryUrl(name)}/${name.replace("/", "%2f")}/${version}`;
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (res.status === 404) throw new Error(`${name}@${version} is not on ${registryUrl(name)}. Is this AgentCut release published?`);
  if (!res.ok) throw new Error(`${name}@${version}: the registry answered ${res.status}`);
  return ((await res.json()) as { dist: Dist }).dist;
}

function run(command: string, args: string[], cwd?: string) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${command} ${args.join(" ")} exited ${code}: ${stderr.trim()}`))));
  });
}


/** Fetch `name@version` from the registry, verify it, and unpack it into `into` (which must not exist yet). */
async function fetchPackage(name: string, version: string, into: string, component: Component, label: string, onProgress: ProgressSink) {
  const dist = await packageDist(name, version);
  const sha512 = dist.integrity?.startsWith("sha512-") ? dist.integrity.slice("sha512-".length) : undefined;
  await fsp.mkdir(into, { recursive: true });
  const tgz = path.join(path.dirname(into), `.${path.basename(into)}.tgz`);
  try {
    await download(dist.tarball, tgz, component, label, onProgress, sha512);
    // Every npm tarball wraps its files in package/.
    await run("tar", ["-xzf", tgz, "-C", into, "--strip-components=1"]);
  } finally {
    await fsp.rm(tgz, { force: true });
  }
  const payload = path.join(into, PAYLOAD);
  if (fs.existsSync(payload)) {
    onProgress({ component, label: `unpacking ${label}`, received: 0, total: 0 });
    await run("tar", ["-xzf", payload, "-C", into]);
    await fsp.rm(payload, { force: true });
    onProgress({ component, label: `unpacked ${label}`, received: 0, total: 0, done: true });
  }
}

/** The platform package that carries Remotion's native compositor, the one part of the renderer that is not JavaScript. */
function compositorPackage() {
  if (process.platform === "linux") {
    const glibc = (process.report?.getReport() as { header?: { glibcVersionRuntime?: string } } | undefined)?.header?.glibcVersionRuntime;
    return `@remotion/compositor-linux-${process.arch}-${glibc ? "gnu" : "musl"}`;
  }
  if (process.platform === "win32") return `@remotion/compositor-win32-${process.arch}-msvc`;
  return `@remotion/compositor-${process.platform}-${process.arch}`;
}

type Manifest = { version: string; agentcut?: { remotion?: string } };
const READY = ".ready";

export const isInstalled = (component: "render" | "studio", version = VERSION) => fs.existsSync(path.join(componentDir(component, version), READY));

/**
 * One versioned component, fetched once. It is unpacked beside its final place and
 * renamed in, so a download that dies halfway never looks installed.
 */
async function ensureComponent(component: "render" | "studio", onProgress: ProgressSink, extra?: (dir: string, manifest: Manifest) => Promise<void>) {
  const dir = componentDir(component);
  if (isInstalled(component)) return dir;
  return withLock(component, async () => {
    if (isInstalled(component)) return dir;
    const staging = `${dir}.partial`;
    await fsp.rm(staging, { recursive: true, force: true });
    await fetchPackage(`@agentcut/${component}`, VERSION, staging, component, `@agentcut/${component} ${VERSION}`, onProgress);
    const manifest = JSON.parse(await fsp.readFile(path.join(staging, "package.json"), "utf8")) as Manifest;
    await extra?.(staging, manifest);
    await fsp.writeFile(path.join(staging, READY), new Date().toISOString());
    await fsp.rm(dir, { recursive: true, force: true });
    await fsp.rename(staging, dir);
    return dir;
  });
}

/**
 * Remotion's own browser, fetched by Remotion into `<nearest package>/node_modules/.remotion`
 * of whatever directory the process happens to be in. Run in a child whose working directory
 * is chosen, so the browser lands where it is meant to live — beside the renderer in the
 * runtime, or at the checkout's root — and report where that is, for every render to be
 * pinned to. Returns the executable's path.
 */
export function ensureRemotionBrowser(cwd: string, requireFrom: string, onProgress: ProgressSink): Promise<string> {
  const script = `
    const r = require("node:module").createRequire(process.env.AGENTCUT_REQUIRE_FROM)("@remotion/renderer");
    const say = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
    r.ensureBrowser({ logLevel: "error", onBrowserDownload: () => ({ version: null, onProgress: (p) => say({ received: p.downloadedBytes, total: p.totalSizeInBytes }) }) })
      .then((s) => say({ status: s }), (e) => { process.stderr.write(String((e && e.message) || e)); process.exit(1); });`;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["-e", script], { cwd, env: { ...process.env, AGENTCUT_REQUIRE_FROM: requireFrom }, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "", buffer = "", found: string | null = null, size = 0;
    child.stderr.on("data", (d) => { stderr += d; });
    child.stdout.on("data", (d) => {
      buffer += d;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const message = JSON.parse(line) as { received?: number; total?: number; status?: { type: string; path?: string } };
        if (message.status) found = message.status.path ?? null;
        else if (message.total) { size = message.total; onProgress({ component: "render", label: "Chrome Headless Shell", received: message.received ?? 0, total: message.total }); }
      }
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code !== 0 || !found) return reject(new Error(`Could not get the renderer's browser: ${stderr.trim() || `exit ${code}`}`));
      if (size) onProgress({ component: "render", label: "Chrome Headless Shell", received: size, total: size, done: true });
      resolve(found);
    });
  });
}

/** Where an installed renderer's browser is, relative to the component, written once it is there. */
export const BROWSER_FILE = "browser.json";

/** The renderer, the prebuilt composition bundle and the browser it renders in: needed by the first export, not before. */
export function ensureRender(onProgress: ProgressSink = terminalProgress()) {
  return ensureComponent("render", onProgress, async (dir, manifest) => {
    const remotion = manifest.agentcut?.remotion;
    if (!remotion) throw new Error("@agentcut/render does not say which Remotion it was built with");
    const pkg = compositorPackage();
    await fetchPackage(pkg, remotion, path.join(dir, "node_modules", ...pkg.split("/")), "render", `${pkg.split("/")[1]} ${remotion}`, onProgress);
    const executable = await ensureRemotionBrowser(dir, path.join(dir, "package.json"), onProgress);
    // Relative: the component is unpacked beside its final place and renamed in.
    // Both sides real paths: on a Mac /tmp is /private/tmp, and Remotion reports the latter.
    await fsp.writeFile(path.join(dir, BROWSER_FILE), JSON.stringify({ executable: path.relative(await fsp.realpath(dir), await fsp.realpath(executable)) }));
  });
}

/** The visual editor: a standalone Next server, needed only by `agentcut studio`. */
export function ensureStudio(onProgress: ProgressSink = terminalProgress()) {
  return ensureComponent("studio", onProgress);
}

/* ------------------------------------------------------------------ status */

async function sizeOf(target: string): Promise<number> {
  const stat = await fsp.lstat(target).catch(() => null);
  if (!stat) return 0;
  if (!stat.isDirectory()) return stat.size;
  let total = 0;
  for (const entry of await fsp.readdir(target)) total += await sizeOf(path.join(target, entry));
  return total;
}

export type ComponentStatus = { component: Component; version: string | null; installed: boolean; bytes: number; path: string; other: string[] };

/** What is on disk, for `agentcut runtime`. */
export async function runtimeStatus(): Promise<ComponentStatus[]> {
  const versions = async (component: "render" | "studio") => (await fsp.readdir(path.join(RUNTIME, component)).catch(() => [] as string[])).filter((v) => !v.endsWith(".partial"));
  const ffmpegVersion = (await fsp.readFile(path.join(RUNTIME, "bin", "VERSION"), "utf8").catch(() => "")).trim();
  const status: ComponentStatus[] = [{
    component: "ffmpeg", version: ffmpegVersion || null, installed: ffmpegReady(),
    bytes: (await sizeOf(runtimeBin("ffmpeg"))) + (await sizeOf(runtimeBin("ffprobe"))), path: path.dirname(runtimeBin("ffmpeg")), other: [],
  }];
  for (const component of ["render", "studio"] as const) {
    const all = await versions(component);
    status.push({
      component, version: isInstalled(component) ? VERSION : null, installed: isInstalled(component),
      bytes: await sizeOf(componentDir(component)), path: componentDir(component), other: all.filter((v) => v !== VERSION),
    });
  }
  return status;
}

/** Remove every downloaded version that is not this CLI's. Returns the bytes freed. */
export async function pruneRuntime(): Promise<number> {
  let freed = 0;
  for (const component of ["render", "studio"] as const) {
    for (const version of (await runtimeStatus()).find((s) => s.component === component)!.other) {
      const dir = path.join(/*turbopackIgnore: true*/ RUNTIME, component, version);
      freed += await sizeOf(dir);
      await fsp.rm(dir, { recursive: true, force: true });
    }
  }
  return freed;
}
