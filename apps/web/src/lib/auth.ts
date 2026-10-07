import type { D1Database } from "../cf";
import type { Context } from "hono";
import { deleteCookie, getSignedCookie, setSignedCookie } from "hono/cookie";
import type { AppEnv, Bindings, User } from "../env";
import { randomToken, sha256Hex } from "./crypto";

export const SESSION_COOKIE = "ac_session";
const SESSION_DAYS = 30;

type UserRow = { id: number; login: string; name: string | null; avatar_url: string | null };

export function toUser(row: UserRow): User {
  return { id: row.id, login: row.login, name: row.name, avatarUrl: row.avatar_url };
}

export function publicUser(user: User) {
  return { login: user.login, name: user.name ?? user.login, avatarUrl: user.avatarUrl };
}

export const devLoginEnabled = (env: Bindings) => env.DEV_LOGIN === "1";
export const githubEnabled = (env: Bindings) => Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET);

/** The cookie signing key. Dev may run without one; production may not. */
function sessionSecret(env: Bindings): string {
  if (env.SESSION_SECRET) return env.SESSION_SECRET;
  if (devLoginEnabled(env)) return "agentcut-local-dev-only";
  throw new Error("SESSION_SECRET is not set");
}

export async function upsertUser(
  db: D1Database,
  input: { login: string; name?: string | null; avatarUrl?: string | null; githubId?: number | null },
): Promise<User> {
  const now = Date.now();
  if (input.githubId != null) {
    const existing = await db.prepare("SELECT id FROM users WHERE github_id = ?").bind(input.githubId).first<{ id: number }>();
    if (existing) {
      await db
        .prepare("UPDATE users SET login = ?, name = ?, avatar_url = ? WHERE id = ?")
        .bind(input.login, input.name ?? null, input.avatarUrl ?? null, existing.id)
        .run();
      return { id: existing.id, login: input.login, name: input.name ?? null, avatarUrl: input.avatarUrl ?? null };
    }
  }
  const row = await db
    .prepare(
      `INSERT INTO users (login, name, avatar_url, github_id, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(login) DO UPDATE SET
         name = COALESCE(excluded.name, users.name),
         avatar_url = COALESCE(excluded.avatar_url, users.avatar_url),
         github_id = COALESCE(excluded.github_id, users.github_id)
       RETURNING id, login, name, avatar_url`,
    )
    .bind(input.login, input.name ?? null, input.avatarUrl ?? null, input.githubId ?? null, now)
    .first<UserRow>();
  if (!row) throw new Error("could not save user");
  return toUser(row);
}

export async function startSession(c: Context<AppEnv>, user: User): Promise<void> {
  const token = randomToken();
  const now = Date.now();
  await c.env.DB.prepare("INSERT INTO sessions (id_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .bind(await sha256Hex(token), user.id, now, now + SESSION_DAYS * 86400_000)
    .run();
  await setSignedCookie(c, SESSION_COOKIE, token, sessionSecret(c.env), {
    path: "/",
    httpOnly: true,
    secure: new URL(c.req.url).protocol === "https:",
    sameSite: "Lax",
    maxAge: SESSION_DAYS * 86400,
  });
}

export async function endSession(c: Context<AppEnv>): Promise<void> {
  const token = await getSignedCookie(c, sessionSecret(c.env), SESSION_COOKIE);
  if (token) await c.env.DB.prepare("DELETE FROM sessions WHERE id_hash = ?").bind(await sha256Hex(token)).run();
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}

export async function sessionUser(c: Context<AppEnv>): Promise<User | null> {
  let secret: string;
  try {
    secret = sessionSecret(c.env);
  } catch {
    return null;
  }
  const token = await getSignedCookie(c, secret, SESSION_COOKIE);
  if (!token) return null;
  const row = await c.env.DB.prepare(
    `SELECT u.id, u.login, u.name, u.avatar_url FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id_hash = ? AND s.expires_at > ?`,
  )
    .bind(await sha256Hex(token), Date.now())
    .first<UserRow>();
  return row ? toUser(row) : null;
}

export const API_TOKEN_PREFIX = "act_";

export async function createApiToken(db: D1Database, userId: number, label: string): Promise<string> {
  const token = `${API_TOKEN_PREFIX}${randomToken()}`;
  await db.prepare("INSERT INTO api_tokens (user_id, token_hash, label, created_at) VALUES (?, ?, ?, ?)")
    .bind(userId, await sha256Hex(token), label, Date.now())
    .run();
  return token;
}

export async function bearerUser(c: Context<AppEnv>): Promise<User | null> {
  const header = c.req.header("authorization") ?? "";
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  if (!match) return null;
  const hash = await sha256Hex(match[1]);
  const row = await c.env.DB.prepare(
    `SELECT u.id, u.login, u.name, u.avatar_url, t.id AS token_id FROM api_tokens t JOIN users u ON u.id = t.user_id
     WHERE t.token_hash = ? AND t.revoked_at IS NULL`,
  )
    .bind(hash)
    .first<UserRow & { token_id: number }>();
  if (!row) return null;
  c.executionCtx.waitUntil(
    c.env.DB.prepare("UPDATE api_tokens SET last_used_at = ? WHERE id = ?").bind(Date.now(), row.token_id).run(),
  );
  return toUser(row);
}

/** Only same-site paths survive as a post-login destination. */
export function safeNext(next: string | undefined | null): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return "/account";
  return next;
}

export const LOGIN_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
