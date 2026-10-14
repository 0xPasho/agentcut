// A Postgres for this machine, with nothing to install: PGlite (Postgres compiled to
// WebAssembly) behind a socket, so the worker reaches it through wrangler's local
// Hyperdrive exactly as it reaches the real database through Hyperdrive in production.
// `pnpm dev` keeps its data in .wrangler/pglite; the tests keep theirs in memory.
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { migrate } from "./migrate.mjs";

/** wrangler reads the local connection string for the HYPERDRIVE binding from this variable. */
export const HYPERDRIVE_ENV = "CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE";

/** Starts the database, migrated; `port: 0` picks a free one. */
export async function startLocalDb({ dataDir, port = 0 } = {}) {
  const db = await PGlite.create(dataDir);
  // A Worker request holds up to five connections; PGlite multiplexes them over its one.
  const server = new PGLiteSocketServer({ db, host: "127.0.0.1", port, maxConnections: 10 });
  await server.start();
  const url = `postgres://postgres:postgres@127.0.0.1:${server.port}/postgres?sslmode=disable`;
  await migrate(url);
  return {
    url,
    async stop() {
      await server.stop();
      await db.close();
    },
  };
}
