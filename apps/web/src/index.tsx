import type { JSX } from "hono/jsx/jsx-runtime";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { csrf } from "hono/csrf";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { html } from "hono/html";
import { HTTPException } from "hono/http-exception";
import type { AppEnv, User } from "./env";
import {
  LOGIN_RE, bearerUser, createApiToken, devLoginEnabled, endSession, githubEnabled, publicUser, safeNext, sessionUser,
  startSession, upsertUser,
} from "./lib/auth";
import { normaliseUserCode, randomToken, sha256Hex, userCode } from "./lib/crypto";
import { contentTypeFor } from "./lib/content-type";
import { getPack, listPacks, objectKey, parseUpload, pathProblem, publish, resolveVersion, sourceUrl } from "./lib/packs";
import { longDate } from "./lib/format";
import { Layout } from "./views/layout";
import { Landing } from "./views/landing";
import { PacksPage } from "./views/packs";
import { PackDetailPage, type NamedDoc, type ReviewSummary } from "./views/pack-detail";
import { AccountPage, DevicePage, LoginPage, MessagePage, type DeviceState, type TokenRow } from "./views/auth";

const DEVICE_TTL_SEC = 600;
const DEVICE_INTERVAL_SEC = 2;
const IMMUTABLE = "public, max-age=31536000, immutable";

const app = new Hono<AppEnv>();

const origin = (c: Context<AppEnv>) => new URL(c.req.url).origin;

/** Renders a full page: doctype, layout and the signed-in user. */
async function page(
  c: Context<AppEnv>,
  title: string,
  body: JSX.Element,
  opts: { status?: number; description?: string } = {},
) {
  const user = c.get("user");
  const path = new URL(c.req.url).pathname;
  const doc = (
    <Layout title={title} description={opts.description} user={user} path={path} canonical={`${origin(c)}${path}`}>
      {body}
    </Layout>
  );
  c.header("cache-control", "no-store");
  return c.html(html`<!doctype html>${doc}`, (opts.status ?? 200) as 200);
}

// The studio fetches the registry from localhost, so reads are open to any origin.
app.use("/api/packs", cors({ origin: "*", allowMethods: ["GET"] }));
app.use("/api/packs/*", cors({ origin: "*", allowMethods: ["GET"] }));
app.use("/r/*", cors({ origin: "*", allowMethods: ["GET", "HEAD"] }));

// Pages see the browser session; the API sees bearer tokens only.
app.use("*", async (c, next) => {
  const path = new URL(c.req.url).pathname;
  c.set("user", path.startsWith("/api/") || path.startsWith("/r/") ? null : await sessionUser(c));
  await next();
});

// Forms post from this origin only.
for (const path of ["/login/dev", "/logout", "/device", "/account/*"]) app.use(path, csrf());

/* ------------------------------------------------------------------ API */

app.get("/api/packs", async (c) => {
  const q = c.req.query("q") ?? "";
  const limit = Number(c.req.query("limit") ?? 50);
  return c.json({ packs: await listPacks(c.env.DB, origin(c), { q, limit }) });
});

app.get("/api/packs/:name", async (c) => {
  const pack = await getPack(c.env.DB, origin(c), c.req.param("name"));
  if (!pack) return c.json({ error: "pack not found" }, 404);
  return c.json({ pack });
});

app.post("/api/packs", async (c) => {
  const user = await bearerUser(c);
  if (!user) return c.json({ error: "sign in first: agentcut login" }, 401);
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "body must be JSON" }, 400);
  }
  const upload = parseUpload(body);
  if ("status" in upload) return c.json(upload.body, upload.status);
  const result = await publish(c.env, user, upload);
  if ("status" in result) return c.json(result.body, result.status);
  const o = origin(c);
  return c.json(
    { name: result.name, version: result.version, url: `${o}/packs/${result.name}`, source: sourceUrl(o, result.name, result.version) },
    201,
  );
});

app.post("/api/auth/device", async (c) => {
  const deviceCode = randomToken(32);
  const now = Date.now();
  // Retry on the rare user-code collision.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = userCode();
    try {
      await c.env.DB.prepare(
        "INSERT INTO device_codes (device_code_hash, user_code, client, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
      )
        .bind(await sha256Hex(deviceCode), code, (c.req.header("user-agent") ?? "").slice(0, 80) || null, now, now + DEVICE_TTL_SEC * 1000)
        .run();
      c.executionCtx.waitUntil(
        c.env.DB.prepare("DELETE FROM device_codes WHERE expires_at < ?").bind(now - 86400_000).run(),
      );
      return c.json({
        deviceCode,
        userCode: code,
        verificationUrl: `${origin(c)}/device?code=${code}`,
        interval: DEVICE_INTERVAL_SEC,
        expiresIn: DEVICE_TTL_SEC,
      });
    } catch (err) {
      if (!String(err).includes("UNIQUE")) throw err;
    }
  }
  return c.json({ error: "could not allocate a code, try again" }, 503);
});

app.post("/api/auth/token", async (c) => {
  const body = await c.req.json<{ deviceCode?: unknown }>().catch(() => ({}) as { deviceCode?: unknown });
  if (typeof body.deviceCode !== "string" || !body.deviceCode) return c.json({ error: "deviceCode is required" }, 400);
  const hash = await sha256Hex(body.deviceCode);
  const row = await c.env.DB.prepare(
    "SELECT status, user_id, client, expires_at FROM device_codes WHERE device_code_hash = ?",
  )
    .bind(hash)
    .first<{ status: string; user_id: number | null; client: string | null; expires_at: number }>();
  if (!row) return c.json({ error: "unknown device code" }, 404);
  if (row.expires_at < Date.now()) return c.json({ error: "expired_token" }, 410);
  if (row.status === "denied") return c.json({ error: "access_denied" }, 403);
  if (row.status !== "approved" || row.user_id == null) return c.json({ error: "authorization_pending" }, 428);

  // One token per approval: the row is consumed by whoever deletes it first.
  const consumed = await c.env.DB.prepare("DELETE FROM device_codes WHERE device_code_hash = ? AND status = 'approved'").bind(hash).run();
  if (!consumed.meta.changes) return c.json({ error: "unknown device code" }, 404);
  const user = await c.env.DB.prepare("SELECT id, login, name, avatar_url FROM users WHERE id = ?")
    .bind(row.user_id)
    .first<{ id: number; login: string; name: string | null; avatar_url: string | null }>();
  if (!user) return c.json({ error: "unknown device code" }, 404);
  const label = row.client ? `CLI · ${row.client}` : `CLI · ${longDate(Date.now())}`;
  const token = await createApiToken(c.env.DB, user.id, label);
  return c.json({ token, user: publicUser({ id: user.id, login: user.login, name: user.name, avatarUrl: user.avatar_url }) });
});

app.get("/api/me", async (c) => {
  const user = await bearerUser(c);
  if (!user) return c.json({ error: "invalid or missing token" }, 401);
  return c.json({ user: publicUser(user) });
});

/** Local development only: a token for a user without the device dance. Used by `pnpm seed:local`. */
app.post("/api/dev/token", async (c) => {
  if (!devLoginEnabled(c.env)) return c.json({ error: "not found" }, 404);
  const body = await c.req.json<{ login?: unknown }>().catch(() => ({}) as { login?: unknown });
  if (typeof body.login !== "string" || !LOGIN_RE.test(body.login)) return c.json({ error: "login must be a GitHub-style username" }, 400);
  const user = await upsertUser(c.env.DB, { login: body.login });
  const token = await createApiToken(c.env.DB, user.id, "dev token");
  return c.json({ token, user: publicUser(user) });
});

app.all("/api/*", (c) => c.json({ error: "not found" }, 404));

/* ------------------------------------------------------------ registry */

app.get("/r/:name/:version/*", async (c) => {
  const name = c.req.param("name");
  const prefix = `/r/${name}/${c.req.param("version")}/`;
  const path = decodeURIComponent(new URL(c.req.url).pathname.slice(prefix.length));
  if (pathProblem(path)) return c.json({ error: "not found" }, 404);
  const requested = c.req.param("version");
  const version = await resolveVersion(c.env.DB, name, requested);
  if (!version) return c.json({ error: "not found" }, 404);
  const object = await c.env.PACKS.get(objectKey(name, version, path));
  if (!object) return c.json({ error: "not found" }, 404);

  if (path === "pack.json" && c.req.method === "GET") {
    c.executionCtx.waitUntil(c.env.DB.prepare("UPDATE packs SET downloads = downloads + 1 WHERE name = ?").bind(name).run());
  }
  const headers = new Headers({
    "content-type": contentTypeFor(path),
    "content-length": String(object.size),
    etag: object.httpEtag,
    "x-content-type-options": "nosniff",
    // A pack is somebody else's bytes on this origin: never let them run as a page.
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; media-src 'self'; sandbox",
    "cache-control": requested === "latest" ? "public, max-age=60" : IMMUTABLE,
  });
  // The R2 stream is the runtime's own ReadableStream; the DOM lib types it separately.
  return new Response(object.body as unknown as ReadableStream, { headers });
});

/* --------------------------------------------------------------- pages */

app.get("/", async (c) => {
  const packs = await listPacks(c.env.DB, origin(c), { limit: 3 });
  return page(c, "agentcut", <Landing packs={packs} />);
});

app.get("/packs", async (c) => {
  const q = (c.req.query("q") ?? "").trim().slice(0, 100);
  const packs = await listPacks(c.env.DB, origin(c), { q, limit: 100 });
  return page(c, q ? `Packs matching “${q}”` : "Packs", <PacksPage packs={packs} q={q} />, {
    description: "Templates, rules, style guides and assets for agentcut, published by the people who edit with them.",
  });
});

app.get("/packs/:name", async (c) => {
  const pack = await getPack(c.env.DB, origin(c), c.req.param("name"));
  if (!pack) {
    return page(c, "Pack not found", <MessagePage title="Pack not found">No pack is published under that name. <a class="text-foreground underline underline-offset-4" href="/packs">Browse packs</a>.</MessagePage>, { status: 404 });
  }
  const read = async (path: string) => {
    if (!path || pathProblem(path)) return null;
    const obj = await c.env.PACKS.get(objectKey(pack.name, pack.latest, path));
    return obj ? obj.text() : null;
  };
  const readJson = async (path: string) => {
    const text = await read(path);
    if (!text) return null;
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      return null;
    }
  };
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const m = pack.manifest;
  const [style, templateDocs, ruleDocs, reviewDoc] = await Promise.all([
    m.style ? read(m.style) : Promise.resolve(null),
    Promise.all(m.templates.map((id) => readJson(`templates/${id}.json`))),
    Promise.all(m.rules.map((id) => readJson(`rules/${id}.json`))),
    m.review ? readJson(m.review) : Promise.resolve(null),
  ]);
  const templates: NamedDoc[] = m.templates.map((id, i) => ({
    id,
    name: str(templateDocs[i]?.name) || id,
    description: str(templateDocs[i]?.description),
  }));
  const rules: NamedDoc[] = m.rules.map((id, i) => ({
    id,
    name: str(ruleDocs[i]?.name) || id,
    description: str(ruleDocs[i]?.description),
    when: str(ruleDocs[i]?.when),
  }));
  let review: ReviewSummary | null = null;
  if (reviewDoc) {
    const checks = Array.isArray(reviewDoc.checks) ? (reviewDoc.checks as Array<{ severity?: string }>) : [];
    const rubric = Array.isArray(reviewDoc.rubric) ? (reviewDoc.rubric as Array<{ severity?: string }>) : [];
    review = {
      checks: checks.length,
      rubric: rubric.length,
      critical: [...checks, ...rubric].filter((x) => x?.severity === "critical").length,
    };
  }
  return page(c, pack.title, <PackDetailPage pack={pack} style={style} templates={templates} rules={rules} review={review} />, {
    description: pack.description || `${pack.title}, a pack for agentcut.`,
  });
});

/* ---------------------------------------------------------------- auth */

const OAUTH_STATE = "ac_oauth";

app.get("/login", (c) => {
  const next = safeNext(c.req.query("next"));
  if (c.get("user")) return c.redirect(next);
  const errors: Record<string, string> = {
    github: "GitHub sign-in did not finish. Try again.",
    state: "That sign-in link expired. Start again.",
    login: "Use letters, digits and single dashes, up to 39 characters.",
  };
  const reason = next.startsWith("/device") ? "Sign in to approve the terminal that is waiting for you." : undefined;
  return page(
    c,
    "Sign in",
    <LoginPage next={next} github={githubEnabled(c.env)} dev={devLoginEnabled(c.env)} error={errors[c.req.query("error") ?? ""]} reason={reason} />,
  );
});

app.post("/login/dev", async (c) => {
  if (!devLoginEnabled(c.env)) return c.notFound();
  const form = await c.req.parseBody();
  const next = safeNext(typeof form.next === "string" ? form.next : null);
  const login = typeof form.login === "string" ? form.login.trim() : "";
  if (!LOGIN_RE.test(login)) return c.redirect(`/login?error=login&next=${encodeURIComponent(next)}`, 303);
  const user = await upsertUser(c.env.DB, { login, name: login });
  await startSession(c, user);
  return c.redirect(next, 303);
});

app.get("/login/github", (c) => {
  if (!githubEnabled(c.env)) return c.redirect("/login");
  const state = randomToken(16);
  const next = safeNext(c.req.query("next"));
  setCookie(c, OAUTH_STATE, `${state}|${next}`, {
    path: "/", httpOnly: true, sameSite: "Lax", maxAge: 600, secure: new URL(c.req.url).protocol === "https:",
  });
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", c.env.GITHUB_CLIENT_ID!);
  url.searchParams.set("redirect_uri", `${origin(c)}/auth/github/callback`);
  url.searchParams.set("scope", "read:user");
  url.searchParams.set("state", state);
  url.searchParams.set("allow_signup", "true");
  return c.redirect(url.toString());
});

app.get("/auth/github/callback", async (c) => {
  if (!githubEnabled(c.env)) return c.redirect("/login");
  const [expected, next] = (getCookie(c, OAUTH_STATE) ?? "").split("|");
  deleteCookie(c, OAUTH_STATE, { path: "/" });
  const code = c.req.query("code");
  if (!expected || c.req.query("state") !== expected || !code) return c.redirect("/login?error=state");

  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({
      client_id: c.env.GITHUB_CLIENT_ID,
      client_secret: c.env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: `${origin(c)}/auth/github/callback`,
    }),
  });
  const tokenJson = (await tokenRes.json().catch(() => ({}))) as { access_token?: string };
  if (!tokenJson.access_token) return c.redirect("/login?error=github");
  const userRes = await fetch("https://api.github.com/user", {
    headers: { authorization: `Bearer ${tokenJson.access_token}`, accept: "application/vnd.github+json", "user-agent": "agentcut-web" },
  });
  if (!userRes.ok) return c.redirect("/login?error=github");
  const gh = (await userRes.json()) as { id: number; login: string; name: string | null; avatar_url: string | null };
  const user = await upsertUser(c.env.DB, { login: gh.login, name: gh.name, avatarUrl: gh.avatar_url, githubId: gh.id });
  await startSession(c, user);
  return c.redirect(safeNext(next));
});

app.post("/logout", async (c) => {
  await endSession(c);
  return c.redirect("/", 303);
});

/* -------------------------------------------------------------- device */

function requireUser(c: Context<AppEnv>): User | Response {
  const user = c.get("user");
  if (user) return user;
  const url = new URL(c.req.url);
  return c.redirect(`/login?next=${encodeURIComponent(url.pathname + url.search)}`);
}

async function pendingDevice(c: Context<AppEnv>, code: string) {
  return c.env.DB.prepare("SELECT user_code, status, expires_at FROM device_codes WHERE user_code = ?")
    .bind(code)
    .first<{ user_code: string; status: string; expires_at: number }>();
}

app.get("/device", async (c) => {
  const user = requireUser(c);
  if (user instanceof Response) return user;
  const raw = c.req.query("code");
  let state: DeviceState = { kind: "enter" };
  if (raw) {
    const code = normaliseUserCode(raw);
    const row = await pendingDevice(c, code);
    if (!row || row.expires_at < Date.now()) state = { kind: "enter", code: raw, error: "That code is not valid or has expired. Run agentcut login again for a new one." };
    else if (row.status === "approved") state = { kind: "approved" };
    else if (row.status === "denied") state = { kind: "denied" };
    else state = { kind: "confirm", code: row.user_code, expiresAt: row.expires_at };
  }
  return page(c, "Sign in the CLI", <DevicePage state={state} user={user} />);
});

app.post("/device", async (c) => {
  const user = requireUser(c);
  if (user instanceof Response) return user;
  const form = await c.req.parseBody();
  const code = normaliseUserCode(typeof form.code === "string" ? form.code : "");
  const decision = form.decision === "approve" ? "approved" : "denied";
  const result = await c.env.DB.prepare(
    "UPDATE device_codes SET status = ?, user_id = ? WHERE user_code = ? AND status = 'pending' AND expires_at > ?",
  )
    .bind(decision, user.id, code, Date.now())
    .run();
  if (!result.meta.changes) {
    return page(c, "Sign in the CLI", <DevicePage state={{ kind: "enter", code, error: "That code is not valid or has expired. Run agentcut login again for a new one." }} user={user} />, { status: 400 });
  }
  return page(c, "Sign in the CLI", <DevicePage state={{ kind: decision === "approved" ? "approved" : "denied" }} user={user} />);
});

/* ------------------------------------------------------------- account */

app.get("/account", async (c) => {
  const user = requireUser(c);
  if (user instanceof Response) return user;
  const [packs, tokens] = await Promise.all([
    listPacks(c.env.DB, origin(c), { ownerId: user.id, limit: 100 }),
    c.env.DB.prepare(
      "SELECT id, label, created_at, last_used_at FROM api_tokens WHERE user_id = ? AND revoked_at IS NULL ORDER BY created_at DESC",
    )
      .bind(user.id)
      .all<{ id: number; label: string; created_at: number; last_used_at: number | null }>(),
  ]);
  const rows: TokenRow[] = tokens.results.map((t) => ({ id: t.id, label: t.label, createdAt: t.created_at, lastUsedAt: t.last_used_at }));
  const notice = c.req.query("revoked") ? "Token revoked. That terminal is signed out." : undefined;
  return page(c, "Account", <AccountPage user={user} packs={packs} tokens={rows} notice={notice} />);
});

app.post("/account/tokens/:id/revoke", async (c) => {
  const user = requireUser(c);
  if (user instanceof Response) return user;
  await c.env.DB.prepare("UPDATE api_tokens SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL")
    .bind(Date.now(), Number(c.req.param("id")), user.id)
    .run();
  return c.redirect("/account?revoked=1", 303);
});

app.notFound((c) => {
  if (new URL(c.req.url).pathname.startsWith("/api/")) return c.json({ error: "not found" }, 404);
  return page(c, "Not found", <MessagePage title="This page does not exist">Check the address, or start from the home page.</MessagePage>, { status: 404 });
});

app.onError((err, c) => {
  if (err instanceof HTTPException) return err.getResponse();
  console.error(err);
  const path = new URL(c.req.url).pathname;
  if (path.startsWith("/api/") || path.startsWith("/r/")) return c.json({ error: "internal error" }, 500);
  return c.text("Something failed on the server. Try again in a moment.", 500);
});

export default app;
