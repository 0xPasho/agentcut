// End to end against the real worker in local workerd (miniflare D1 + R2), through wrangler's test harness.
// Offline: nothing here reaches the network.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createTestHarness } from "wrangler";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const packsDir = path.resolve(root, "../../packs");

let server;
let base;

before(async () => {
  server = createTestHarness({ root, workers: [{ configPath: "./wrangler.jsonc", vars: { DEV_LOGIN: "1" } }] });
  ({ url: base } = await server.listen());
  await server.getWorker().applyD1Migrations("DB");
});

after(async () => {
  await server?.close();
});

const url = (p) => new URL(p, base).toString();
const b64 = (text) => Buffer.from(text).toString("base64");

async function api(p, init = {}) {
  const res = await fetch(url(p), init);
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body, headers: res.headers };
}

async function devToken(login) {
  const { status, body } = await api("/api/dev/token", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ login }),
  });
  assert.equal(status, 200);
  return body.token;
}

function publish(token, files) {
  return api("/api/packs", {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ files }),
  });
}

/** A small pack with a template, a rule with a prompt file, an asset, a style guide and a recipe. */
function tinyPack({ id = "tiny-pack", version = "1.0.0", name = "Tiny pack", description = "A pack for tests.", drop = [] } = {}) {
  const manifest = {
    schema: 1, id, name, version, author: "tester", description,
    templates: ["tiny-look"],
    rules: ["tiny-rule"],
    assets: [{ file: "assets/sting.mp3", kind: "audio", name: "Sting" }],
    style: "STYLE.md",
    recipes: [{ id: "intro", label: "Intro", file: "recipes/intro.mjs" }],
    recipeFiles: ["recipes/lib/util.mjs"],
  };
  const files = {
    "pack.json": JSON.stringify(manifest),
    "templates/tiny-look.json": JSON.stringify({ id: "tiny-look", name: "Tiny look", description: "Looks tiny." }),
    "rules/tiny-rule.json": JSON.stringify({ id: "tiny-rule", name: "Tiny rule", when: "always", then: { promptFile: "tiny-rule.md" } }),
    "rules/tiny-rule.md": "Keep it tiny.",
    "assets/sting.mp3": "ID3fake-audio",
    "STYLE.md": "# Tiny\n\nSmall <script>alert(1)</script> videos.",
    "recipes/intro.mjs": "export default async () => ({ ok: true });",
    "recipes/lib/util.mjs": "export const x = 1;",
  };
  return Object.entries(files).filter(([p]) => !drop.includes(p)).map(([p, text]) => ({ path: p, base64: b64(text) }));
}

describe("publish", () => {
  let alice;
  let bob;
  before(async () => {
    alice = await devToken("alice");
    bob = await devToken("bob");
  });

  test("401 without a token", async () => {
    const res = await publish(null, tinyPack());
    assert.equal(res.status, 401);
    assert.ok(res.body.error);
  });

  test("happy path stores the pack and answers with its URLs", async () => {
    const res = await publish(alice, tinyPack());
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.deepEqual(res.body, {
      name: "tiny-pack",
      version: "1.0.0",
      url: url("/packs/tiny-pack"),
      source: url("/r/tiny-pack/1.0.0"),
    });
  });

  test("a file the manifest names must be in the upload", async () => {
    const res = await publish(alice, tinyPack({ id: "missing-pack", drop: ["recipes/lib/util.mjs"] }));
    assert.equal(res.status, 400);
    assert.match(res.body.error, /recipes\/lib\/util\.mjs/);
  });

  test("a rule's prompt file counts as referenced", async () => {
    const res = await publish(alice, tinyPack({ id: "missing-prompt", drop: ["rules/tiny-rule.md"] }));
    assert.equal(res.status, 400);
    assert.match(res.body.error, /rules\/tiny-rule\.md/);
  });

  test("paths may not leave the pack or be absolute", async () => {
    for (const bad of ["../escape.txt", "assets/../../x", "/etc/passwd", "assets\\win.txt", "a//b", "./x"]) {
      const files = [...tinyPack({ id: "traversal" }), { path: bad, base64: b64("x") }];
      const res = await publish(alice, files);
      assert.equal(res.status, 400, `${bad}: ${JSON.stringify(res.body)}`);
    }
  });

  test("pack.json must parse against the schema", async () => {
    const files = tinyPack({ id: "bad-schema" }).map((f) =>
      f.path === "pack.json" ? { path: f.path, base64: b64(JSON.stringify({ id: "Bad Id", name: "" })) } : f);
    const res = await publish(alice, files);
    assert.equal(res.status, 400);
    assert.ok(Array.isArray(res.body.issues));
  });

  test("version must look like semver", async () => {
    const res = await publish(alice, tinyPack({ id: "bad-version", version: "v1" }));
    assert.equal(res.status, 400);
  });

  test("another publisher cannot take the name", async () => {
    const res = await publish(bob, tinyPack({ version: "9.9.9" }));
    assert.equal(res.status, 403);
  });

  test("the same version cannot be published twice", async () => {
    const res = await publish(alice, tinyPack());
    assert.equal(res.status, 409);
    assert.deepEqual(res.body, { error: "version exists" });
  });

  test("latest is the highest version, not the newest upload", async () => {
    assert.equal((await publish(alice, tinyPack({ version: "2.0.0", description: "Second." }))).status, 201);
    assert.equal((await publish(alice, tinyPack({ version: "1.5.0" }))).status, 201);
    assert.equal((await publish(alice, tinyPack({ version: "2.0.0-beta.1" }))).status, 201);
    const { body } = await api("/api/packs/tiny-pack");
    assert.equal(body.pack.latest, "2.0.0");
    assert.equal(body.pack.description, "Second.");
    assert.deepEqual(body.pack.versions.map((v) => v.version), ["2.0.0", "2.0.0-beta.1", "1.5.0", "1.0.0"]);
  });
});

describe("the example packs", () => {
  test("all three publish as they are in the repository", async () => {
    const token = await devToken("pasho");
    for (const name of ["news-desk", "showcase", "stream-shorts"]) {
      const dir = path.join(packsDir, name);
      const rels = (await readdir(dir, { recursive: true, withFileTypes: true }))
        .filter((e) => e.isFile() && e.name !== ".DS_Store")
        .map((e) => path.relative(dir, path.join(e.parentPath, e.name)).split(path.sep).join("/"));
      const files = await Promise.all(rels.map(async (p) => ({ path: p, base64: (await readFile(path.join(dir, p))).toString("base64") })));
      const res = await publish(token, files);
      assert.equal(res.status, 201, `${name}: ${JSON.stringify(res.body)}`);
    }
  });
});

describe("list and search", () => {
  test("lists every pack with its listing shape", async () => {
    const { status, body, headers } = await api("/api/packs");
    assert.equal(status, 200);
    assert.equal(headers.get("access-control-allow-origin"), "*");
    const tiny = body.packs.find((p) => p.name === "tiny-pack");
    assert.deepEqual(Object.keys(tiny).sort(), ["author", "counts", "description", "downloads", "latest", "name", "owner", "source", "title", "updatedAt"]);
    assert.equal(tiny.title, "Tiny pack");
    assert.equal(tiny.author, "tester");
    assert.deepEqual(tiny.owner, { login: "alice", avatarUrl: null });
    assert.deepEqual(tiny.counts, { templates: 1, rules: 1, assets: 1, recipes: 1 });
    assert.equal(tiny.source, url("/r/tiny-pack/2.0.0"));
    assert.equal(typeof tiny.updatedAt, "number");
  });

  test("q matches name, title and description", async () => {
    const byName = await api("/api/packs?q=stream-sh");
    assert.deepEqual(byName.body.packs.map((p) => p.name), ["stream-shorts"]);
    const byTitle = await api(`/api/packs?q=${encodeURIComponent("comparativas")}`);
    assert.deepEqual(byTitle.body.packs.map((p) => p.name), ["showcase"]);
    const byDescription = await api("/api/packs?q=Second.");
    assert.deepEqual(byDescription.body.packs.map((p) => p.name), ["tiny-pack"]);
    const none = await api("/api/packs?q=nothing-matches-this");
    assert.deepEqual(none.body.packs, []);
    const wildcard = await api("/api/packs?q=%25");
    assert.deepEqual(wildcard.body.packs, []);
  });

  test("limit caps the list", async () => {
    const { body } = await api("/api/packs?limit=2");
    assert.equal(body.packs.length, 2);
  });
});

describe("detail", () => {
  test("returns versions and the manifest", async () => {
    const { status, body } = await api("/api/packs/showcase");
    assert.equal(status, 200);
    assert.equal(body.pack.name, "showcase");
    assert.equal(body.pack.manifest.id, "showcase");
    assert.equal(body.pack.counts.recipes, 3);
    assert.equal(body.pack.versions.length, 1);
    assert.equal(typeof body.pack.versions[0].size, "number");
    assert.equal(typeof body.pack.versions[0].publishedAt, "number");
  });

  test("404 for an unknown pack", async () => {
    const res = await api("/api/packs/does-not-exist");
    assert.equal(res.status, 404);
    assert.ok(res.body.error);
  });

  test("the page escapes the style guide and warns about recipes", async () => {
    const res = await fetch(url("/packs/tiny-pack"));
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(!html.includes("<script>alert(1)</script>"));
    assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
    assert.ok(html.includes("This pack carries code"));
    assert.ok(html.includes("agentcut packs install tiny-pack"));
    assert.ok(html.includes(url("/r/tiny-pack/2.0.0")));
  });
});

describe("registry files", () => {
  test("serves files with a content type and counts pack.json fetches", async () => {
    const before = (await api("/api/packs/showcase")).body.pack.downloads;
    const manifest = await fetch(url("/r/showcase/1.0.0/pack.json"));
    assert.equal(manifest.status, 200);
    assert.match(manifest.headers.get("content-type"), /^application\/json/);
    assert.equal(manifest.headers.get("cache-control"), "public, max-age=31536000, immutable");
    assert.equal(manifest.headers.get("access-control-allow-origin"), "*");
    assert.equal((await manifest.json()).id, "showcase");

    const recipe = await fetch(url("/r/showcase/1.0.0/recipes/teaser.mjs"));
    assert.equal(recipe.status, 200);
    assert.match(recipe.headers.get("content-type"), /^text\/javascript/);
    await recipe.arrayBuffer();

    const audio = await fetch(url("/r/showcase/1.0.0/assets/cinematic-dramatic-buildup.mp3"));
    assert.equal(audio.headers.get("content-type"), "audio/mpeg");
    const bytes = Buffer.from(await audio.arrayBuffer());
    const original = await readFile(path.join(packsDir, "showcase/assets/cinematic-dramatic-buildup.mp3"));
    assert.ok(bytes.equals(original), "asset bytes round-trip");

    const style = await fetch(url("/r/showcase/1.0.0/STYLE.md"));
    assert.match(style.headers.get("content-type"), /^text\/markdown/);
    await style.arrayBuffer();

    // Only pack.json counts as an install.
    await new Promise((r) => setTimeout(r, 200));
    const after = (await api("/api/packs/showcase")).body.pack.downloads;
    assert.equal(after, before + 1);
  });

  test("latest resolves to the latest version", async () => {
    const res = await fetch(url("/r/tiny-pack/latest/pack.json"));
    assert.equal(res.status, 200);
    assert.equal((await res.json()).version, "2.0.0");
    const old = await fetch(url("/r/tiny-pack/1.0.0/pack.json"));
    assert.equal((await old.json()).version, "1.0.0");
  });

  test("404 for missing files, versions and packs", async () => {
    for (const p of ["/r/tiny-pack/1.0.0/nope.json", "/r/tiny-pack/7.0.0/pack.json", "/r/nobody/latest/pack.json"]) {
      const res = await fetch(url(p));
      assert.equal(res.status, 404, p);
      await res.arrayBuffer();
    }
  });
});

describe("device login", () => {
  async function devSession(login) {
    const res = await fetch(url("/login/dev"), {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded", origin: new URL(base).origin },
      body: new URLSearchParams({ login, next: "/account" }),
    });
    assert.equal(res.status, 303);
    const cookie = res.headers.get("set-cookie").split(";")[0];
    assert.match(cookie, /^ac_session=/);
    return cookie;
  }

  const poll = (deviceCode) => api("/api/auth/token", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ deviceCode }),
  });

  test("pending, then approved, then a token that works on /api/me", async () => {
    const start = await api("/api/auth/device", { method: "POST" });
    assert.equal(start.status, 200);
    const { deviceCode, userCode, verificationUrl, interval, expiresIn } = start.body;
    assert.ok(deviceCode.length >= 32);
    assert.match(userCode, /^[A-Z]{4}-[A-Z]{4}$/);
    assert.equal(verificationUrl, url(`/device?code=${userCode}`));
    assert.equal(interval, 2);
    assert.equal(expiresIn, 600);

    const pending = await poll(deviceCode);
    assert.equal(pending.status, 428);
    assert.deepEqual(pending.body, { error: "authorization_pending" });

    const cookie = await devSession("carol");
    const page = await fetch(url(`/device?code=${userCode}`), { headers: { cookie } });
    assert.equal(page.status, 200);
    assert.ok((await page.text()).includes(userCode));

    const approve = await fetch(url("/device"), {
      method: "POST",
      headers: { cookie, "content-type": "application/x-www-form-urlencoded", origin: new URL(base).origin },
      body: new URLSearchParams({ code: userCode.toLowerCase().replace("-", ""), decision: "approve" }),
    });
    assert.equal(approve.status, 200);
    await approve.arrayBuffer();

    const done = await poll(deviceCode);
    assert.equal(done.status, 200);
    assert.match(done.body.token, /^act_/);
    assert.deepEqual(done.body.user, { login: "carol", name: "carol", avatarUrl: null });

    const me = await api("/api/me", { headers: { authorization: `Bearer ${done.body.token}` } });
    assert.equal(me.status, 200);
    assert.deepEqual(me.body, { user: { login: "carol", name: "carol", avatarUrl: null } });

    // The approval is consumed: a second poll does not mint a second token.
    assert.equal((await poll(deviceCode)).status, 404);
  });

  test("denied answers access_denied", async () => {
    const { body } = await api("/api/auth/device", { method: "POST" });
    const cookie = await devSession("dave");
    const deny = await fetch(url("/device"), {
      method: "POST",
      headers: { cookie, "content-type": "application/x-www-form-urlencoded", origin: new URL(base).origin },
      body: new URLSearchParams({ code: body.userCode, decision: "deny" }),
    });
    await deny.arrayBuffer();
    const res = await poll(body.deviceCode);
    assert.equal(res.status, 403);
    assert.deepEqual(res.body, { error: "access_denied" });
  });

  test("an approval form from another origin is refused", async () => {
    const { body } = await api("/api/auth/device", { method: "POST" });
    const cookie = await devSession("erin");
    const res = await fetch(url("/device"), {
      method: "POST",
      headers: { cookie, "content-type": "application/x-www-form-urlencoded", origin: "https://evil.example" },
      body: new URLSearchParams({ code: body.userCode, decision: "approve" }),
    });
    assert.equal(res.status, 403);
    await res.arrayBuffer();
    assert.equal((await poll(body.deviceCode)).status, 428);
  });

  test("an expired code answers expired_token", async () => {
    const { body } = await api("/api/auth/device", { method: "POST" });
    const env = await server.getWorker().getEnv();
    await env.DB.prepare("UPDATE device_codes SET expires_at = 1 WHERE user_code = ?").bind(body.userCode).run();
    const res = await poll(body.deviceCode);
    assert.equal(res.status, 410);
    assert.deepEqual(res.body, { error: "expired_token" });
  });

  test("unknown device codes are 404 and bad tokens are 401", async () => {
    assert.equal((await poll("not-a-real-code")).status, 404);
    assert.equal((await api("/api/me")).status, 401);
    assert.equal((await api("/api/me", { headers: { authorization: "Bearer act_nope" } })).status, 401);
  });

  test("/device asks for a sign-in first", async () => {
    const res = await fetch(url("/device?code=ABCD-EFGH"), { redirect: "manual" });
    assert.equal(res.status, 302);
    assert.match(res.headers.get("location"), /^\/login\?next=%2Fdevice/);
  });
});

describe("pages", () => {
  test("landing, packs and login render", async () => {
    for (const p of ["/", "/packs", "/packs?q=stream", "/login"]) {
      const res = await fetch(url(p));
      assert.equal(res.status, 200, p);
      const html = await res.text();
      assert.match(html, /^<!doctype html>/i, p);
    }
    const missing = await fetch(url("/packs/nope"));
    assert.equal(missing.status, 404);
    await missing.arrayBuffer();
  });
});
