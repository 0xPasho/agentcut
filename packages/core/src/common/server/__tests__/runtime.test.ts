/**
 * The runtime an installed CLI downloads on first use, against a registry and an ffmpeg
 * mirror served from this process. Each case runs in a child pointed at a fake install
 * (a package called `agentcut`), because a checkout never downloads anything.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { REPO } from "../../../modules/__tests__/repo";

const RUNTIME_TS = path.join(REPO, "packages/core/src/common/server/runtime.ts");
const TSX = path.join(REPO, "node_modules/.bin/tsx");
let dir: string;
let server: http.Server;
let base: string;
const files = new Map<string, Buffer>();
const hits: string[] = [];
let corrupt = false;

/** An npm tarball: everything under package/, optionally with a payload archive of its own. */
function tarball(name: string, manifest: Record<string, unknown>, payload?: Record<string, string>) {
  const work = fs.mkdtempSync(path.join(dir, "pack-"));
  const pkg = path.join(work, "package");
  fs.mkdirSync(pkg);
  fs.writeFileSync(path.join(pkg, "package.json"), JSON.stringify({ name, version: "1.2.3", ...manifest }));
  if (payload) {
    const inner = path.join(work, "inner");
    for (const [file, text] of Object.entries(payload)) {
      fs.mkdirSync(path.dirname(path.join(inner, file)), { recursive: true });
      fs.writeFileSync(path.join(inner, file), text);
    }
    execFileSync("tar", ["-czf", path.join(pkg, "payload.tar.gz"), "-C", inner, "."], { env: { ...process.env, COPYFILE_DISABLE: "1" } });
  }
  execFileSync("tar", ["-czf", path.join(work, "out.tgz"), "-C", work, "package"], { env: { ...process.env, COPYFILE_DISABLE: "1" } });
  return fs.readFileSync(path.join(work, "out.tgz"));
}

function publish(name: string, version: string, tgz: Buffer) {
  const file = `/tarballs/${name.replace("/", "-")}-${version}.tgz`;
  files.set(file, tgz);
  files.set(`/${name.replace("/", "%2f")}/${version}`, Buffer.from(JSON.stringify({
    name, version, dist: { tarball: `${base}${file}`, integrity: `sha512-${createHash("sha512").update(tgz).digest("base64")}` },
  })));
}

before(async () => {
  dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "agentcut-runtime-"));
  server = http.createServer((req, res) => {
    hits.push(req.url!);
    const body = files.get(req.url!);
    if (!body) return res.writeHead(404).end("{}");
    const sent = corrupt && req.url!.endsWith(".tgz") ? Buffer.concat([body, Buffer.from("x")]) : body;
    res.writeHead(200, { "content-length": String(sent.length) }).end(sent);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

  publish("@agentcut/studio", "1.2.3", tarball("@agentcut/studio", { agentcut: { server: "apps/studio/server.js" } }, {
    "apps/studio/server.js": "console.log('studio')",
    "node_modules/next/package.json": JSON.stringify({ name: "next" }),
  }));
  const compositor = process.platform === "linux" ? `@remotion/compositor-linux-${process.arch}-gnu` : process.platform === "win32" ? `@remotion/compositor-win32-${process.arch}-msvc` : `@remotion/compositor-${process.platform}-${process.arch}`;
  publish(compositor, "4.0.0", tarball(compositor, {}, { "compositor": "binary" }));
  for (const name of ["ffmpeg", "ffprobe"]) {
    const platform = `${process.platform}-${process.arch}`;
    files.set(`/ffmpeg/${name}-${platform}.gz`, gzipSync(Buffer.from(`#!/bin/sh\necho ${name} from the mirror\n`)));
  }
});
after(async () => { await new Promise((r) => server.close(r)); fs.rmSync(dir, { recursive: true, force: true }); });

/** Run `code` against runtime.ts as an installed CLI whose home is `home`. */
async function installed(home: string, code: string, env: Record<string, string> = {}) {
  const install = path.join(dir, "install");
  fs.mkdirSync(install, { recursive: true });
  fs.writeFileSync(path.join(install, "package.json"), JSON.stringify({ name: "agentcut", version: "1.2.3" }));
  const script = `import(${JSON.stringify(RUNTIME_TS)}).then(async (r) => { const out = await (async () => { ${code} })(); console.log("::" + JSON.stringify(out ?? null)); }).catch((e) => { console.log("::" + JSON.stringify({ error: e.message })); });`;
  // Not spawnSync: the registry is served by this very process, which must keep answering.
  const child = spawn(TSX, ["-e", script], {
    env: { ...process.env, AGENTCUT_ROOT: install, AGENTCUT_HOME: home, AGENTCUT_REGISTRY: base, AGENTCUT_FFMPEG_MIRROR: `${base}/ffmpeg`, AGENTCUT_VERSION: "", AGENTCUT_BUILD_VERSION: "", AGENTCUT_FFMPEG: "", AGENTCUT_FFPROBE: "", ...env },
  });
  const run = { stdout: "", stderr: "", status: null as number | null };
  child.stdout.on("data", (d) => { run.stdout += d; });
  child.stderr.on("data", (d) => { run.stderr += d; });
  run.status = await new Promise<number | null>((resolve) => child.on("exit", resolve));
  assert.equal(run.status, 0, run.stderr);
  const line = run.stdout.split("\n").find((l) => l.startsWith("::"));
  assert.ok(line, run.stdout + run.stderr);
  return { result: JSON.parse(line.slice(2)), stderr: run.stderr };
}

test("the studio is fetched once, verified, unpacked from its payload and pinned to the CLI's version", async () => {
  const home = path.join(dir, "home-studio");
  const first = await installed(home, `return { dir: await r.ensureStudio(), version: r.VERSION, installed: r.isInstalled("studio") };`);
  assert.equal(first.result.version, "1.2.3");
  assert.equal(first.result.installed, true);
  const studio = first.result.dir;
  assert.equal(studio, path.join(home, "runtime", "studio", "1.2.3"));
  assert.equal(fs.readFileSync(path.join(studio, "apps/studio/server.js"), "utf8"), "console.log('studio')");
  assert.ok(fs.existsSync(path.join(studio, "node_modules/next/package.json")), "node_modules survives inside the payload");
  assert.ok(!fs.existsSync(path.join(studio, "payload.tar.gz")), "the payload is removed once unpacked");
  assert.match(first.stderr, /@agentcut\/studio 1\.2\.3/);

  const downloads = hits.filter((h) => h.endsWith(".tgz")).length;
  await installed(home, `return r.ensureStudio();`);
  assert.equal(hits.filter((h) => h.endsWith(".tgz")).length, downloads, "a second run downloads nothing");
});

test("a download that does not match the registry's checksum installs nothing", async () => {
  const home = path.join(dir, "home-corrupt");
  corrupt = true;
  try {
    const { result } = await installed(home, `return r.ensureStudio();`);
    assert.match(result.error, /checksum/);
  } finally {
    corrupt = false;
  }
  assert.ok(!fs.existsSync(path.join(home, "runtime", "studio", "1.2.3")), "nothing looks installed");
  const { result } = await installed(home, `return r.isInstalled("studio");`);
  assert.equal(result, false);
});

test("a release that is not on the registry says so", async () => {
  const { result } = await installed(path.join(dir, "home-missing"), `return r.ensureStudio();`, { AGENTCUT_VERSION: "9.9.9" });
  assert.match(result.error, /@agentcut\/studio@9\.9\.9 is not on http:\/\/127\.0\.0\.1/);
});

test("ffmpeg and ffprobe come from the mirror for this platform, executable", async () => {
  const home = path.join(dir, "home-ffmpeg");
  const { result } = await installed(home, `await r.ensureFfmpeg(); return [r.runtimeBin("ffmpeg"), r.runtimeBin("ffprobe")];`);
  for (const [i, name] of ["ffmpeg", "ffprobe"].entries()) {
    assert.equal(result[i], path.join(home, "runtime", "bin", name));
    if (process.platform !== "win32") assert.equal(execFileSync(result[i], { encoding: "utf8" }).trim(), `${name} from the mirror`);
  }
  const status = (await installed(home, `return r.runtimeStatus();`)).result as Array<{ component: string; installed: boolean; version: string | null }>;
  assert.deepEqual(status.map((s) => [s.component, s.installed]), [["ffmpeg", true], ["render", false], ["studio", false]]);
});

test("the registry is the one npm would use: AGENTCUT_REGISTRY, then a scoped line, then the plain one", async () => {
  const rc = path.join(dir, "npmrc");
  fs.writeFileSync(rc, "registry=https://plain.example/\n@agentcut:registry=https://scoped.example/\n");
  const env = { AGENTCUT_REGISTRY: "", npm_config_registry: "", NPM_CONFIG_REGISTRY: "", NPM_CONFIG_USERCONFIG: rc, npm_config_userconfig: rc };
  const { result } = await installed(path.join(dir, "home-rc"), `return [r.registryUrl("@agentcut/studio"), r.registryUrl("@remotion/x"), r.registryUrl("agentcut")];`, env);
  assert.deepEqual(result, ["https://scoped.example", "https://plain.example", "https://plain.example"]);
});

test("old versions are pruned, the current one is kept", async () => {
  const home = path.join(dir, "home-prune");
  await installed(home, `return r.ensureStudio();`);
  const old = path.join(home, "runtime", "studio", "1.0.0");
  fs.mkdirSync(old, { recursive: true });
  fs.writeFileSync(path.join(old, "big"), Buffer.alloc(1024));
  const { result } = await installed(home, `return r.pruneRuntime();`);
  assert.ok(result >= 1024);
  assert.ok(!fs.existsSync(old));
  assert.ok(fs.existsSync(path.join(home, "runtime", "studio", "1.2.3", "apps/studio/server.js")));
});

test("a checkout never downloads", async () => {
  const script = `import(${JSON.stringify(RUNTIME_TS)}).then(async (r) => { await r.ensureFfmpeg(); console.log("::ok"); })`;
  const run = spawnSync(TSX, ["-e", script], { encoding: "utf8", env: { ...process.env, AGENTCUT_ROOT: "", AGENTCUT_HOME: path.join(dir, "home-checkout"), AGENTCUT_FFMPEG_MIRROR: "http://127.0.0.1:1/nothing" } });
  assert.equal(run.status, 0, run.stderr);
  assert.ok(!fs.existsSync(path.join(dir, "home-checkout", "runtime")));
});
