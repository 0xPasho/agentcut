// Bundle the CLI into dist/: one launcher and one file per command, sharing chunks.
// Everything core needs is inlined (zod included); the heavy parts — ffmpeg, the
// renderer, the studio — are fetched at run time by core's runtime manager.
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const dist = path.join(here, "dist");
const pkg = JSON.parse(fs.readFileSync(path.join(here, "package.json"), "utf8"));

fs.rmSync(dist, { recursive: true, force: true });
fs.rmSync(path.join(here, "assets"), { recursive: true, force: true });

const commands = fs.readdirSync(path.join(here, "src", "commands")).filter((f) => f.endsWith(".ts"));
await build({
  entryPoints: {
    agentcut: path.join(here, "src", "bin.ts"),
    ...Object.fromEntries(commands.map((f) => [`commands/${f.replace(/\.ts$/, "")}`, path.join(here, "src", "commands", f)])),
  },
  outdir: dist,
  outExtension: { ".js": ".mjs" },
  bundle: true,
  splitting: true,
  format: "esm",
  platform: "node",
  target: "node22",
  chunkNames: "chunks/[name]-[hash]",
  minify: false,
  sourcemap: false,
  legalComments: "none",
  // The version every downloaded component is pinned to.
  define: { "process.env.AGENTCUT_BUILD_VERSION": JSON.stringify(pkg.version) },
  // CommonJS dependencies inlined into ESM still reach for these.
  banner: {
    js: [
      "import { createRequire as __agentcutRequire } from 'node:module';",
      "import { fileURLToPath as __agentcutPath } from 'node:url';",
      "const require = __agentcutRequire(import.meta.url);",
      "const __filename = __agentcutPath(import.meta.url);",
      "const __dirname = __agentcutPath(new URL('.', import.meta.url));",
    ].join("\n"),
  },
  logLevel: "warning",
});

const launcher = path.join(dist, "agentcut.mjs");
fs.writeFileSync(launcher, `#!/usr/bin/env node\n${fs.readFileSync(launcher, "utf8")}`);
fs.chmodSync(launcher, 0o755);

// Read at run time by path, not imported: the recipe sandbox and core's assets.
fs.copyFileSync(path.join(root, "packages/core/src/modules/packs/server/recipe-runner.mjs"), path.join(dist, "recipe-runner.mjs"));
fs.cpSync(path.join(root, "packages/core/assets"), path.join(here, "assets"), { recursive: true });

const size = (dir) => fs.readdirSync(dir, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? size(path.join(dir, e.name)) : fs.statSync(path.join(dir, e.name)).size), 0);
console.log(`agentcut ${pkg.version}: dist ${(size(dist) / 1024).toFixed(0)} KB, assets ${(size(path.join(here, "assets")) / 1024).toFixed(0)} KB`);
