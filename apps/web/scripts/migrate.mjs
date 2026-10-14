// Applies migrations/*.sql, in name order, to a Postgres database: each file once, in its
// own transaction, recorded in schema_migrations. The same runner serves production, the
// local dev database and the tests, so all three hold the same schema.
//
// usage: DATABASE_URL=postgres://… pnpm db:migrate
//   Production: the agentcut_app role on the owner's Postgres, with ?sslmode=require.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const migrationsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../migrations");

/** Applies what is missing; returns the names it applied. */
export async function migrate(url, { log = () => {} } = {}) {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await sql`CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at BIGINT NOT NULL)`;
    const done = new Set((await sql`SELECT name FROM schema_migrations`).map((r) => r.name));
    const files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();
    const applied = [];
    for (const file of files) {
      if (done.has(file)) continue;
      const text = await readFile(path.join(migrationsDir, file), "utf8");
      await sql.begin(async (tx) => {
        await tx.unsafe(text);
        await tx`INSERT INTO schema_migrations (name, applied_at) VALUES (${file}, ${Date.now()})`;
      });
      applied.push(file);
      log(`applied ${file}`);
    }
    return applied;
  } finally {
    await sql.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("Set DATABASE_URL to the database to migrate.");
    process.exit(1);
  }
  const applied = await migrate(url, { log: console.log });
  console.log(applied.length ? `${applied.length} migration(s) applied.` : "Up to date.");
}
