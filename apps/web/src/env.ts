import type { Fetcher, Hyperdrive } from "./cf";
import type { Sql } from "./lib/db";

export type Bindings = {
  /** Postgres on the owner's server; `lib/db.ts` turns it into a client. */
  HYPERDRIVE: Hyperdrive;
  ASSETS: Fetcher;
  /** "1" signs every visitor in as a local identity, for `pnpm dev` and the tests. Never "1" in production. */
  DEV_LOGIN?: string;
  /** The GitHub login the local identity owns repos as. Only read when DEV_LOGIN is "1". */
  DEV_GITHUB_LOGIN?: string;
  CLERK_SECRET_KEY?: string;
  CLERK_PUBLISHABLE_KEY?: string;
  /** Where GitHub lives. Overridden in tests; nothing else should change them. */
  GITHUB_API_BASE?: string;
  GITHUB_RAW_BASE?: string;
};

/**
 * Somebody who can submit a pack. `login` is their GitHub login, because a pack is a
 * GitHub repository and only its owner may register it.
 */
export type User = { id: number; clerkId: string | null; login: string; name: string | null; avatarUrl: string | null };

export type AppEnv = { Bindings: Bindings; Variables: { user: User | null; sql: Sql } };
