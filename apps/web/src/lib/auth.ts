/**
 * Who is asking. Clerk holds the accounts; this file turns a request into a row in
 * `users` and, when we need to read a private detail of somebody's repository, into
 * their GitHub token.
 *
 * Signing in is never required to browse, install or search. It is required only to
 * register a pack, update it or remove it — the three things that write.
 *
 * With no Clerk keys (a `pnpm dev` checkout, the tests) every visitor is a local
 * identity instead, so nothing on this machine ever asks anybody to sign in.
 */
import { createClerkClient, type ClerkClient } from "@clerk/backend";
import type { Context } from "hono";
import type { AppEnv, Bindings, User } from "../env";
import type { Sql } from "./db";

export const clerkEnabled = (env: Bindings) => Boolean(env.CLERK_SECRET_KEY && env.CLERK_PUBLISHABLE_KEY);
export const devLoginEnabled = (env: Bindings) => env.DEV_LOGIN === "1";

/** A GitHub login: letters, digits and single dashes, up to 39 characters. */
export const LOGIN_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;

/** The client is keyed by the secret so a changed binding cannot be served from a stale isolate. */
let cached: { key: string; client: ClerkClient } | null = null;

export function clerk(env: Bindings): ClerkClient | null {
  if (!clerkEnabled(env)) return null;
  const key = env.CLERK_SECRET_KEY!;
  if (cached?.key !== key) {
    cached = { key, client: createClerkClient({ secretKey: key, publishableKey: env.CLERK_PUBLISHABLE_KEY! }) };
  }
  return cached.client;
}

type UserRow = { id: number; clerk_id: string | null; login: string; name: string | null; avatar_url: string | null };

const toUser = (row: UserRow): User => ({
  id: row.id,
  clerkId: row.clerk_id,
  login: row.login,
  name: row.name,
  avatarUrl: row.avatar_url,
});

/**
 * The local row for a signed-in person, created on their first visit. Clerk owns the
 * account; this row exists so a pack can point at an owner.
 */
export async function upsertUser(
  sql: Sql,
  input: { clerkId: string | null; login: string; name?: string | null; avatarUrl?: string | null },
): Promise<User> {
  const now = Date.now();
  const name = input.name ?? null;
  const avatarUrl = input.avatarUrl ?? null;
  if (input.clerkId) {
    const [existing] = await sql<{ id: number }[]>`SELECT id FROM users WHERE clerk_id = ${input.clerkId}`;
    if (existing) {
      await sql`UPDATE users SET login = ${input.login}, name = ${name}, avatar_url = ${avatarUrl} WHERE id = ${existing.id}`;
      return { id: existing.id, clerkId: input.clerkId, login: input.login, name, avatarUrl };
    }
  }
  const [row] = await sql<UserRow[]>`
    INSERT INTO users (clerk_id, login, name, avatar_url, created_at)
    VALUES (${input.clerkId}, ${input.login}, ${name}, ${avatarUrl}, ${now})
    ON CONFLICT ((lower(login))) DO UPDATE SET
      clerk_id = COALESCE(excluded.clerk_id, users.clerk_id),
      name = COALESCE(excluded.name, users.name),
      avatar_url = COALESCE(excluded.avatar_url, users.avatar_url)
    RETURNING id, clerk_id, login, name, avatar_url`;
  if (!row) throw new Error("could not save user");
  return toUser(row);
}

/**
 * The local identity, for a checkout with no Clerk keys. `x-dev-login` names it, so the
 * tests can be two different people; otherwise it is DEV_GITHUB_LOGIN, or `local`.
 */
async function devUser(c: Context<AppEnv>): Promise<User> {
  const asked = c.req.header("x-dev-login") ?? c.req.query("dev_login") ?? c.env.DEV_GITHUB_LOGIN ?? "local";
  const login = LOGIN_RE.test(asked) ? asked : "local";
  return upsertUser(c.var.sql, { clerkId: null, login, name: login });
}

/**
 * Either who is asking, or the response Clerk needs us to send first. A handshake is
 * Clerk refreshing its cookie on this origin: a redirect back to the same page, with
 * the headers it handed us. No browser script is involved.
 */
export type Identified = { user: User | null; response?: Response };

export async function identify(c: Context<AppEnv>): Promise<Identified> {
  if (devLoginEnabled(c.env)) return { user: await devUser(c) };
  const client = clerk(c.env);
  if (!client) return { user: null };

  const state = await client.authenticateRequest(c.req.raw);
  if (state.status === "handshake") return { user: null, response: new Response(null, { status: 307, headers: state.headers }) };
  const auth = state.toAuth();
  if (!auth?.userId) return { user: null };

  const account = await client.users.getUser(auth.userId);
  const login = githubLogin(account);
  // No GitHub account on the Clerk user: they are signed in, but own no repositories here.
  if (!login) return { user: { id: 0, clerkId: account.id, login: "", name: account.firstName, avatarUrl: account.imageUrl || null } };
  const user = await upsertUser(c.var.sql, {
    clerkId: account.id,
    login,
    name: [account.firstName, account.lastName].filter(Boolean).join(" ") || login,
    avatarUrl: account.imageUrl || null,
  });
  return { user };
}

/** The GitHub login behind a Clerk account, from the external account it signed in with. */
function githubLogin(account: { externalAccounts: Array<{ provider: string; username: string | null }> }): string | null {
  const github = account.externalAccounts.find((a) => a.provider === "oauth_github" || a.provider === "github");
  const username = github?.username ?? null;
  return username && LOGIN_RE.test(username) ? username : null;
}

/**
 * The person's own GitHub token, so a repository they can see is a repository we can
 * read. Null when Clerk has no token for them, and the read falls back to anonymous.
 */
export async function githubToken(c: Context<AppEnv>, user: User): Promise<string | null> {
  const client = clerk(c.env);
  if (!client || !user.clerkId) return null;
  try {
    const { data } = await client.users.getUserOauthAccessToken(user.clerkId, "github");
    return data[0]?.token ?? null;
  } catch {
    return null;
  }
}

/** Where Clerk hosts sign-in for this instance, with somewhere to come back to. */
export async function signInUrl(c: Context<AppEnv>, next: string): Promise<string | null> {
  const client = clerk(c.env);
  if (!client) return null;
  const state = await client.authenticateRequest(c.req.raw);
  if (!state.signInUrl) return null;
  const url = new URL(state.signInUrl);
  url.searchParams.set("redirect_url", new URL(next, c.req.url).toString());
  return url.toString();
}

/** Only same-site paths survive as a post-sign-in destination. */
export function safeNext(next: string | undefined | null): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return "/account";
  return next;
}
