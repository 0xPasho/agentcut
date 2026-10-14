// `pnpm dev`: the local database, then `wrangler dev` pointed at it. Offline, no
// Cloudflare login, no Clerk keys; delete .wrangler/ to start empty.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HYPERDRIVE_ENV, startLocalDb } from "./local-db.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const db = await startLocalDb({ dataDir: path.join(root, ".wrangler/pglite") });
console.log(`Local Postgres (PGlite) at ${db.url}`);

const wrangler = spawn("pnpm", ["exec", "wrangler", "dev", "--port", "8787", "--var", "DEV_LOGIN:1", ...process.argv.slice(2)], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, [HYPERDRIVE_ENV]: db.url },
});

let stopping = false;
async function stop(code) {
  if (stopping) return;
  stopping = true;
  wrangler.kill("SIGINT");
  await db.stop();
  process.exit(code);
}
wrangler.on("exit", (code) => stop(code ?? 0));
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
