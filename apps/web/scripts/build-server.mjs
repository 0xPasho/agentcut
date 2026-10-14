// Bundle the website for the owner's server: dist/server.mjs (the site) and
// dist/migrate.mjs (the schema). Everything is inlined — hono, postgres, @clerk/backend
// and the core pack schema — so the box needs node and nothing else: no pnpm install, no
// node_modules, no checkout of a monorepo whose other packages weigh hundreds of
// megabytes. `deploy/deploy.sh` rsyncs dist/, public/ and migrations/ and restarts pm2.
//
// usage: node scripts/build-server.mjs   (run build:css first; deploy.sh does both)
import { build } from "esbuild";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(here, "dist");

fs.rmSync(dist, { recursive: true, force: true });

// The hash src/lib/assets.ts puts in the URLs of the files a deploy changes.
const versioned = ["public/styles.css", "public/login.js"];
const hash = createHash("sha256");
for (const file of versioned) hash.update(fs.readFileSync(path.join(here, file)));
const assetVersion = hash.digest("hex").slice(0, 12);

await build({
  entryPoints: {
    server: path.join(here, "src/node.ts"),
    migrate: path.join(here, "scripts/migrate.mjs"),
  },
  outdir: dist,
  outExtension: { ".js": ".mjs" },
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  define: { __ASSET_VERSION__: JSON.stringify(assetVersion) },
  jsx: "automatic",
  jsxImportSource: "hono/jsx",
  minify: false,
  sourcemap: false,
  legalComments: "none",
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

const kb = (file) => `${(fs.statSync(path.join(dist, file)).size / 1024).toFixed(0)} KB`;
console.log(`dist/server.mjs ${kb("server.mjs")}, dist/migrate.mjs ${kb("migrate.mjs")}, assets ${assetVersion}`);
