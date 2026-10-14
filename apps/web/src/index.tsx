import type { JSX } from "hono/jsx/jsx-runtime";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { csrf } from "hono/csrf";
import { deleteCookie } from "hono/cookie";
import { html } from "hono/html";
import { HTTPException } from "hono/http-exception";
import type { AppEnv, User } from "./env";
import { clerk, clerkEnabled, githubToken, identify, safeNext, signInUrl } from "./lib/auth";
import { GitHub } from "./lib/github";
import { getPack, listPacks, pathProblem, refreshPack, registerPack, removePack } from "./lib/packs";
import { Layout } from "./views/layout";
import { Landing } from "./views/landing";
import { PacksPage } from "./views/packs";
import { PackDetailPage, type NamedDoc, type ReviewSummary } from "./views/pack-detail";
import { AccountPage, MessagePage, SignInPage, SubmitPage } from "./views/account";

const app = new Hono<AppEnv>();

const origin = (c: Context<AppEnv>) => new URL(c.req.url).origin;

/** Reading from GitHub as nobody in particular: enough to build a source URL. */
const reader = (c: Context<AppEnv>) => new GitHub(c.env);

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

// The studio reads the registry from localhost, so reads are open to any origin.
app.use("/api/packs", cors({ origin: "*", allowMethods: ["GET"] }));
app.use("/api/packs/*", cors({ origin: "*", allowMethods: ["GET"] }));

// Pages see who is asking; the registry's reads are anonymous and never ask Clerk.
app.use("*", async (c, next) => {
  if (new URL(c.req.url).pathname.startsWith("/api/")) {
    c.set("user", null);
    return next();
  }
  const { user, response } = await identify(c);
  if (response) return response;
  c.set("user", user);
  await next();
});

// Forms post from this origin only.
for (const path of ["/submit", "/logout", "/packs/*"]) app.use(path, csrf());

/* ------------------------------------------------------------------ API */

app.get("/api/packs", async (c) => {
  const q = c.req.query("q") ?? "";
  const limit = Number(c.req.query("limit") ?? 50);
  return c.json({ packs: await listPacks(c.env.DB, reader(c), { q, limit }) });
});

app.get("/api/packs/:name", async (c) => {
  const pack = await getPack(c.env.DB, reader(c), c.req.param("name"));
  if (!pack) return c.json({ error: "pack not found" }, 404);
  return c.json({ pack });
});

app.all("/api/*", (c) => c.json({ error: "not found" }, 404));

/* --------------------------------------------------------------- pages */

app.get("/", async (c) => {
  const packs = await listPacks(c.env.DB, reader(c), { limit: 3 });
  return page(c, "agentcut", <Landing packs={packs} />);
});

app.get("/packs", async (c) => {
  const q = (c.req.query("q") ?? "").trim().slice(0, 100);
  const packs = await listPacks(c.env.DB, reader(c), { q, limit: 100 });
  return page(c, q ? `Packs matching “${q}”` : "Packs", <PacksPage packs={packs} q={q} />, {
    description: "Templates, rules, style guides and assets for agentcut, from the repositories the people who edit with them keep them in.",
  });
});

/** The pack's own page, with the files of its pinned commit read from GitHub. */
async function packPage(
  c: Context<AppEnv>,
  name: string,
  notice?: { kind: "ok" | "error"; text: string },
  status?: number,
) {
  const gh = reader(c);
  const pack = await getPack(c.env.DB, gh, name);
  if (!pack) {
    return page(
      c,
      "Pack not found",
      <MessagePage title="Pack not found">
        No pack is registered under that name. <a class="text-foreground underline underline-offset-4" href="/packs">Browse packs</a>.
      </MessagePage>,
      { status: 404 },
    );
  }
  const sha = pack.versions.find((v) => v.version === pack.latest)?.sha ?? pack.versions[0].sha;
  const at = (path: string) => (pack.repo.folder ? `${pack.repo.folder}/${path}` : path);
  const read = async (path: string) => {
    if (!path || pathProblem(path)) return null;
    return gh.file(pack.repo.owner, pack.repo.name, sha, at(path)).catch(() => null);
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
  const user = c.get("user");
  return page(
    c,
    pack.title,
    <PackDetailPage pack={pack} style={style} templates={templates} rules={rules} review={review}
      owned={Boolean(user && user.login.toLowerCase() === pack.owner.login.toLowerCase())} notice={notice} />,
    { description: pack.description || `${pack.title}, a pack for agentcut.`, status },
  );
}

app.get("/packs/:name", (c) => {
  const submitted = c.req.query("submitted");
  return packPage(c, c.req.param("name"), submitted ? { kind: "ok", text: `Version ${submitted} is registered. Anybody can install it now.` } : undefined);
});

/* --------------------------------------------------------- submitting */

/** The three writes need an account. Everything else on this site does not. */
function requireUser(c: Context<AppEnv>): User | Response {
  const user = c.get("user");
  if (user) return user;
  const url = new URL(c.req.url);
  return c.redirect(`/login?next=${encodeURIComponent(url.pathname + url.search)}`, 303);
}

app.get("/submit", async (c) => {
  const user = requireUser(c);
  if (user instanceof Response) return user;
  return page(c, "Submit a pack", <SubmitPage user={user} repo={c.req.query("repo") ?? ""} folder={c.req.query("folder") ?? ""} />, {
    description: "Register a GitHub repository as an agentcut pack.",
  });
});

app.post("/submit", async (c) => {
  const user = requireUser(c);
  if (user instanceof Response) return user;
  const form = await c.req.parseBody();
  const repo = typeof form.repo === "string" ? form.repo : "";
  const folder = typeof form.folder === "string" ? form.folder : "";
  const gh = new GitHub(c.env, await githubToken(c, user));
  const result = await registerPack(c.env.DB, gh, user, { repo, folder });
  if ("status" in result) {
    return page(c, "Submit a pack", <SubmitPage user={user} repo={repo} folder={folder} error={result.body.error} issues={result.body.issues} />, {
      status: result.status,
    });
  }
  return c.redirect(`/packs/${result.name}?submitted=${encodeURIComponent(result.version)}`, 303);
});

app.post("/packs/:name/refresh", async (c) => {
  const user = requireUser(c);
  if (user instanceof Response) return user;
  const name = c.req.param("name");
  const gh = new GitHub(c.env, await githubToken(c, user));
  const result = await refreshPack(c.env.DB, gh, user, name);
  if ("status" in result) return packPage(c, name, { kind: "error", text: result.body.error }, result.status);
  if (!result.updated) {
    return packPage(c, name, {
      kind: "ok",
      text: `No new version: ${name} ${result.version} is the version in pack.json on ${result.sha.slice(0, 7)}. Bump it to register a new one.`,
    });
  }
  return packPage(c, name, { kind: "ok", text: `Version ${result.version} is registered.` });
});

app.post("/packs/:name/remove", async (c) => {
  const user = requireUser(c);
  if (user instanceof Response) return user;
  const name = c.req.param("name");
  const result = await removePack(c.env.DB, user, name);
  if (result !== true) return packPage(c, name, { kind: "error", text: result.body.error }, result.status);
  return c.redirect("/account?removed=1", 303);
});

/* ---------------------------------------------------------------- auth */

app.get("/login", async (c) => {
  const next = safeNext(c.req.query("next"));
  if (c.get("user")) return c.redirect(next);
  const url = await signInUrl(c, next);
  if (url) return c.redirect(url);
  return page(c, "Sign in", <SignInPage configured={clerkEnabled(c.env)} />);
});

app.post("/logout", async (c) => {
  const client = clerk(c.env);
  if (client) {
    const state = await client.authenticateRequest(c.req.raw);
    const sessionId = state.toAuth()?.sessionId;
    if (sessionId) await client.sessions.revokeSession(sessionId).catch(() => {});
  }
  // Clerk's cookies on this origin. Removing them signs this browser out of the site.
  for (const name of ["__session", "__client_uat", "__clerk_db_jwt"]) deleteCookie(c, name, { path: "/" });
  return c.redirect("/", 303);
});

/* ------------------------------------------------------------- account */

app.get("/account", async (c) => {
  const user = requireUser(c);
  if (user instanceof Response) return user;
  const packs = user.id ? await listPacks(c.env.DB, reader(c), { ownerId: user.id, limit: 100 }) : [];
  const notice = c.req.query("removed") ? "That pack is no longer listed. Its repository is untouched." : undefined;
  return page(c, "Account", <AccountPage user={user} packs={packs} notice={notice} />);
});

app.notFound((c) => {
  if (new URL(c.req.url).pathname.startsWith("/api/")) return c.json({ error: "not found" }, 404);
  return page(c, "Not found", <MessagePage title="This page does not exist">Check the address, or start from the home page.</MessagePage>, { status: 404 });
});

app.onError((err, c) => {
  if (err instanceof HTTPException) return err.getResponse();
  console.error(err);
  if (new URL(c.req.url).pathname.startsWith("/api/")) return c.json({ error: "internal error" }, 500);
  return c.text("Something failed on the server. Try again in a moment.", 500);
});

export default app;
