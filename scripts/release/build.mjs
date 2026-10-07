// Build the three published packages into .release/, all at the CLI's version:
//
//   agentcut          packages/cli (bundled with esbuild; published from there)
//   @agentcut/render  the prebuilt Remotion bundle + the renderer's JavaScript
//   @agentcut/studio  the studio as a standalone Next server
//
// The last two are fetched by the CLI on first use (core's common/server/runtime.ts).
// Their files travel as payload.tar.gz inside the npm package, because npm's packer
// drops node_modules directories and symlinks, which is most of what they are.
//
// usage: node scripts/release/build.mjs [cli] [render] [studio]   (default: all three)
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = path.join(ROOT, ".release");
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, "packages/cli/package.json"), "utf8")).version;
const wanted = process.argv.slice(2).length ? process.argv.slice(2) : ["cli", "render", "studio"];
const core = createRequire(path.join(ROOT, "packages/core/package.json"));
const REMOTION = JSON.parse(fs.readFileSync(core.resolve("@remotion/renderer/package.json"), "utf8")).version;

const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: "inherit", ...opts });
const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const sizeOf = (p) => {
  const st = fs.lstatSync(p);
  if (!st.isDirectory()) return st.size;
  return fs.readdirSync(p).reduce((n, e) => n + sizeOf(path.join(p, e)), 0);
};

/** One archive of `from`'s contents, symlinks kept, no macOS resource forks. */
function payload(from, to) {
  sh("tar", ["-czf", to, "-C", from, "."], { env: { ...process.env, COPYFILE_DISABLE: "1" } });
}

function manifest(name, description, extra = {}) {
  return {
    name, version: VERSION, description, license: "UNLICENSED",
    repository: { type: "git", url: "git+https://github.com/0xPasho/agentcut.git" },
    files: ["payload.tar.gz"],
    ...extra,
  };
}

function buildCli() {
  sh(process.execPath, [path.join(ROOT, "packages/cli/build.mjs")]);
}

async function buildRender() {
  const stage = path.join(OUT, "render");
  const work = path.join(OUT, ".render-work");
  fs.rmSync(stage, { recursive: true, force: true });
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(path.join(work, "files"), { recursive: true });

  // The compositions, bundled once here instead of on every machine at every render.
  const { bundle } = core("@remotion/bundler");
  const { enableTailwind } = core("@remotion/tailwind-v4");
  console.log("bundling compositions…");
  await bundle({
    entryPoint: path.join(ROOT, "packages/render/src/index.ts"),
    outDir: path.join(work, "files", "bundle"),
    publicDir: null,
    enableCaching: false,
    webpackOverride: enableTailwind,
  });

  // The renderer's JavaScript. The native compositor is per platform and is fetched by
  // the CLI for the machine it runs on, so optional dependencies are left out here.
  fs.writeFileSync(path.join(work, "files", "package.json"), JSON.stringify({ private: true, dependencies: { "@remotion/renderer": REMOTION } }));
  sh("npm", ["install", "--omit=optional", "--ignore-scripts", "--no-audit", "--no-fund", "--no-package-lock", "--loglevel=error"], { cwd: path.join(work, "files") });
  fs.rmSync(path.join(work, "files", "package.json"));

  fs.mkdirSync(stage, { recursive: true });
  payload(path.join(work, "files"), path.join(stage, "payload.tar.gz"));
  fs.writeFileSync(path.join(stage, "package.json"), JSON.stringify(manifest("@agentcut/render", "AgentCut's renderer: the compositions, prebuilt, and Remotion's renderer. Downloaded by the agentcut CLI on the first export.", {
    agentcut: { remotion: REMOTION },
  }), null, 2));
  console.log(`@agentcut/render ${VERSION}: ${mb(sizeOf(path.join(work, "files")))} unpacked, ${mb(sizeOf(path.join(stage, "payload.tar.gz")))} packed (Remotion ${REMOTION})`);
  fs.rmSync(work, { recursive: true, force: true });
}

function buildStudio() {
  const app = path.join(ROOT, "apps/studio");
  const dist = ".next-release";
  const stage = path.join(OUT, "studio");
  fs.rmSync(stage, { recursive: true, force: true });
  fs.rmSync(path.join(app, dist), { recursive: true, force: true });

  console.log("building the studio (standalone)…");
  sh(path.join(app, "node_modules/.bin/next"), ["build"], {
    cwd: app,
    env: { ...process.env, AGENTCUT_STANDALONE: "1", AGENTCUT_NEXT_DIST: dist, NEXT_TELEMETRY_DISABLED: "1" },
  });

  // Next leaves the static files and public/ for a CDN; the studio serves them itself.
  const standalone = path.join(app, dist, "standalone");
  const served = path.join(standalone, "apps/studio");
  fs.cpSync(path.join(app, dist, "static"), path.join(served, dist, "static"), { recursive: true });
  fs.cpSync(path.join(app, "public"), path.join(served, "public"), { recursive: true });
  // The trace copies whatever a dynamic fs call might reach. None of it runs in the studio.
  for (const stray of ["workspace", ".release", "packs", "apps/web"]) fs.rmSync(path.join(standalone, stray), { recursive: true, force: true });
  // next/image is not used, and sharp is one platform's native build: the studio
  // package has to run anywhere, so it ships without it.
  const pnpmDir = path.join(standalone, "node_modules/.pnpm");
  for (const entry of fs.readdirSync(pnpmDir)) if (/^(sharp@|@img\+)/.test(entry)) fs.rmSync(path.join(pnpmDir, entry), { recursive: true, force: true });

  fs.mkdirSync(stage, { recursive: true });
  payload(standalone, path.join(stage, "payload.tar.gz"));
  fs.writeFileSync(path.join(stage, "package.json"), JSON.stringify(manifest("@agentcut/studio", "AgentCut's visual editor as a standalone server. Downloaded by the agentcut CLI the first time you run agentcut.", {
    agentcut: { server: "apps/studio/server.js" },
  }), null, 2));
  console.log(`@agentcut/studio ${VERSION}: ${mb(sizeOf(standalone))} unpacked, ${mb(sizeOf(path.join(stage, "payload.tar.gz")))} packed`);
}

fs.mkdirSync(OUT, { recursive: true });
if (wanted.includes("cli")) buildCli();
if (wanted.includes("render")) await buildRender();
if (wanted.includes("studio")) buildStudio();
