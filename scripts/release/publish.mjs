// Publish what scripts/release/build.mjs produced, in the order that never leaves a
// published CLI pointing at a component that is not there yet: render, studio, CLI.
//
// usage: node scripts/release/publish.mjs [--registry <url>] [--tag <dist-tag>] [--dry-run]
//
// Publishing to npmjs needs `npm login` with rights to the `agentcut` package and the
// `@agentcut` scope. A local registry (verdaccio) is how the release is rehearsed;
// see docs/RELEASING.md.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const argv = process.argv.slice(2);
const flag = (name) => { const i = argv.indexOf(`--${name}`); return i === -1 ? undefined : argv[i + 1]; };
const registry = flag("registry");
const tag = flag("tag");
const dryRun = argv.includes("--dry-run");

const order = [path.join(ROOT, ".release/render"), path.join(ROOT, ".release/studio"), path.join(ROOT, "packages/cli")];
const version = JSON.parse(fs.readFileSync(path.join(ROOT, "packages/cli/package.json"), "utf8")).version;

for (const dir of order) {
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
  if (pkg.version !== version) throw new Error(`${pkg.name} is ${pkg.version}, the CLI is ${version}: run scripts/release/build.mjs first`);
  if (pkg.name !== "agentcut" && !fs.existsSync(path.join(dir, "payload.tar.gz"))) throw new Error(`${pkg.name} has no payload: run scripts/release/build.mjs first`);
  if (pkg.name === "agentcut" && !fs.existsSync(path.join(dir, "dist/agentcut.mjs"))) throw new Error("the CLI is not built: run scripts/release/build.mjs first");
}

for (const dir of order) {
  const args = ["publish", "--access", "public", ...(registry ? ["--registry", registry] : []), ...(tag ? ["--tag", tag] : []), ...(dryRun ? ["--dry-run"] : [])];
  console.log(`\n$ npm ${args.join(" ")}   (${path.relative(ROOT, dir)})`);
  execFileSync("npm", args, { cwd: dir, stdio: "inherit" });
}
console.log(`\nPublished agentcut ${version}${registry ? ` to ${registry}` : ""}.`);
