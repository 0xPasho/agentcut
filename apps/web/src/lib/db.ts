/**
 * The database: Postgres on the owner's server, reached through Hyperdrive, which keeps
 * the connections open next to the database so a request does not pay for a handshake
 * from the edge. Hyperdrive wants a client per request; it connects on the first query
 * and is closed once the response has gone.
 */
import postgres from "postgres";
import type { Hyperdrive } from "../cf";

/** Times are milliseconds in BIGINT columns: they come back as numbers, not strings. */
const bigint = { to: 20, from: [20], serialize: (n: number) => String(n), parse: (s: string) => Number(s) };

export function connect(hyperdrive: Hyperdrive) {
  return postgres(hyperdrive.connectionString, {
    // A Worker may hold six connections out at once; leave one for fetch.
    max: 5,
    // No array or custom types here, so skip the round trip that looks them up.
    fetch_types: false,
    types: { bigint },
  });
}

export type Sql = ReturnType<typeof connect>;

/** Postgres's code for a unique violation: somebody else got there first. */
export const isUniqueViolation = (error: unknown) => (error as { code?: unknown } | null)?.code === "23505";
