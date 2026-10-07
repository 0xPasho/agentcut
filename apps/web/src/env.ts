import type { D1Database, Fetcher, R2Bucket } from "./cf";

export type Bindings = {
  DB: D1Database;
  PACKS: R2Bucket;
  ASSETS: Fetcher;
  /** "1" enables the username-only login and POST /api/dev/token. Local only. */
  DEV_LOGIN?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  SESSION_SECRET?: string;
};

export type User = { id: number; login: string; name: string | null; avatarUrl: string | null };

export type AppEnv = { Bindings: Bindings; Variables: { user: User | null } };
