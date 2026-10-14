// End to end against the real worker in local workerd (miniflare D1), through wrangler's
// test harness, with GitHub stood in for by an http server in this process: the worker is
// pointed at it with GITHUB_API_BASE and GITHUB_RAW_BASE.
//
// Offline: nothing here reaches the network.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createTestHarness } from "wrangler";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const packsDir = path.resolve(root, "../../packs");

/* ------------------------------------------------------------------ GitHub */

/** Every repository the stub knows: `owner/name` → what GitHub would answer about it. */
const repos = new Map();

function putRepo(slug, { files, sha = "a".repeat(40), stars = 0, isPrivate = false, defaultBranch = "main" }) {
  const [owner, name] = slug.split("/");
  repos.set(slug.toLowerCase(), { owner, name, files: new Map(Object.entries(files)), sha, stars, isPrivate, defaultBranch });
}

let github;
let githubBase;

function startGitHub() {
  github = http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    const json = (status, value) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(value));
    const parts = url.pathname.split("/").filter(Boolean);

    // GET /repos/:owner/:repo …
    if (parts[0] === "repos") {
      const repo = repos.get(`${parts[1]}/${parts[2]}`.toLowerCase());
      if (!repo) return json(404, { message: "Not Found" });
      const tail = parts.slice(3);
      if (!tail.length) {
        return json(200, {
          name: repo.name, default_branch: repo.defaultBranch, stargazers_count: repo.stars, private: repo.isPrivate,
          html_url: `https://github.com/${repo.owner}/${repo.name}`,
          owner: { login: repo.owner, avatar_url: null },
        });
      }
      if (tail[0] === "commits") {
        const ref = decodeURIComponent(tail[1] ?? "");
        if (ref !== repo.defaultBranch && ref !== repo.sha) return json(404, { message: "No commit found" });
        return json(200, { sha: repo.sha });
      }
      if (tail[0] === "git" && tail[1] === "trees") {
        if (tail[2] !== repo.sha) return json(404, { message: "Not Found" });
        return json(200, {
          sha: repo.sha,
          truncated: false,
          tree: [...repo.files].map(([p, text]) => ({ path: p, type: "blob", size: Buffer.byteLength(text) })),
        });
      }
      return json(404, { message: "Not Found" });
    }

    // raw: /raw/:owner/:repo/:sha/<path>
    if (parts[0] === "raw") {
      const repo = repos.get(`${parts[1]}/${parts[2]}`.toLowerCase());
      const file = repo && parts[3] === repo.sha ? repo.files.get(parts.slice(4).map(decodeURIComponent).join("/")) : undefined;
      if (file === undefined) return res.writeHead(404).end();
      if (req.method === "HEAD") return res.writeHead(200, { "content-length": String(Buffer.byteLength(file)) }).end();
      return res.writeHead(200, { "content-type": "text/plain" }).end(file);
    }
    json(404, { message: "Not Found" });
  });
  return new Promise((resolve) => {
    github.listen(0, "127.0.0.1", () => {
      githubBase = `http://127.0.0.1:${github.address().port}`;
      resolve();
    });
  });
}

/* ------------------------------------------------------------------- packs */

/** A small pack with a template, a rule with a prompt file, an asset, a style guide and a recipe. */
function tinyPack({ id = "tiny-pack", version = "1.0.0", name = "Tiny pack", description = "A pack for tests.", drop = [], folder = "" } = {}) {
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
  const prefix = folder ? `${folder}/` : "";
  return Object.fromEntries(
    Object.entries(files).filter(([p]) => !drop.includes(p)).map(([p, text]) => [`${prefix}${p}`, text]),
  );
}

/* ------------------------------------------------------------------ server */

let server;
let base;

before(async () => {
  await startGitHub();
  server = createTestHarness({
    root,
    workers: [{
      configPath: "./wrangler.jsonc",
      vars: { DEV_LOGIN: "1", GITHUB_API_BASE: githubBase, GITHUB_RAW_BASE: `${githubBase}/raw` },
    }],
  });
  ({ url: base } = await server.listen());
  await server.getWorker().applyD1Migrations("DB");
});

after(async () => {
  await server?.close();
  await new Promise((r) => github?.close(r));
});

const url = (p) => new URL(p, base).toString();

async function api(p, init = {}) {
  const res = await fetch(url(p), init);
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body, headers: res.headers };
}

/** Submit a repository as `login`, the way the form does. */
async function submit(login, { repo, folder = "" }) {
  const res = await fetch(url("/submit"), {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", origin: new URL(base).origin, "x-dev-login": login },
    body: new URLSearchParams({ repo, folder }),
  });
  const text = res.status === 303 ? "" : await res.text();
  return { status: res.status, location: res.headers.get("location"), text, error: firstAlert(text) };
}

async function post(p, login) {
  const res = await fetch(url(p), {
    method: "POST",
    redirect: "manual",
    headers: { origin: new URL(base).origin, "x-dev-login": login },
  });
  const text = res.status === 303 ? "" : await res.text();
  return { status: res.status, location: res.headers.get("location"), text, notice: firstAlert(text) };
}

/** What the page says went wrong (or right), without its markup. */
function firstAlert(html) {
  const found = /role="(?:alert|status)"[^>]*>([\s\S]*?)<\/p>/.exec(html ?? "");
  return found ? found[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : "";
}

/* -------------------------------------------------------------------------- */

describe("submitting a repository", () => {
  before(() => {
    putRepo("alice/tiny", { files: tinyPack(), stars: 7 });
    putRepo("alice/monorepo", { files: tinyPack({ id: "folder-pack", folder: "packs/folder-pack" }), sha: "c".repeat(40) });
    putRepo("alice/secret", { files: tinyPack({ id: "secret-pack" }), isPrivate: true });
    putRepo("bob/tiny-too", { files: tinyPack({ id: "tiny-pack", version: "9.0.0" }) });
  });

  test("a repository becomes a pack whose source is GitHub at the pinned commit", async () => {
    const posted = await submit("alice", { repo: "https://github.com/alice/tiny" });
    assert.equal(posted.status, 303);
    assert.equal(posted.location, "/packs/tiny-pack?submitted=1.0.0");

    const { status, body } = await api("/api/packs/tiny-pack");
    assert.equal(status, 200);
    assert.equal(body.pack.latest, "1.0.0");
    assert.equal(body.pack.stars, 7);
    assert.equal(body.pack.owner.login, "alice");
    assert.deepEqual(body.pack.repo, { owner: "alice", name: "tiny", folder: "", branch: "main", url: "https://github.com/alice/tiny" });
    assert.equal(body.pack.source, `${githubBase}/raw/alice/tiny/${"a".repeat(40)}`);
    assert.deepEqual(body.pack.counts, { templates: 1, rules: 1, assets: 1, recipes: 1 });
    assert.deepEqual(body.pack.versions, [{ version: "1.0.0", publishedAt: body.pack.versions[0].publishedAt, size: body.pack.versions[0].size, sha: "a".repeat(40), source: `${githubBase}/raw/alice/tiny/${"a".repeat(40)}` }]);
    assert.ok(body.pack.versions[0].size > 0, "the size is the bytes of the files it names");
  });

  test("a link to a folder registers that folder", async () => {
    const posted = await submit("alice", { repo: "github.com/alice/monorepo/tree/main/packs/folder-pack" });
    assert.equal(posted.status, 303);
    const { body } = await api("/api/packs/folder-pack");
    assert.equal(body.pack.repo.folder, "packs/folder-pack");
    assert.equal(body.pack.source, `${githubBase}/raw/alice/monorepo/${"c".repeat(40)}/packs/folder-pack`);
    assert.equal(body.pack.repo.url, "https://github.com/alice/monorepo/tree/main/packs/folder-pack");
  });

  test("only the GitHub account that owns the repository may submit it", async () => {
    const posted = await submit("carol", { repo: "alice/tiny" });
    assert.equal(posted.status, 403);
    assert.match(posted.error, /is not yours/);
  });

  test("a name belongs to whoever submitted it first", async () => {
    const posted = await submit("bob", { repo: "bob/tiny-too" });
    assert.equal(posted.status, 403);
    assert.match(posted.error, /belongs to another publisher/);
  });

  test("a private repository is refused: nobody else could install it", async () => {
    const posted = await submit("alice", { repo: "alice/secret" });
    assert.equal(posted.status, 400);
    assert.match(posted.error, /private/);
  });

  test("a repository GitHub does not have is a 404, and a bad address never reaches GitHub", async () => {
    assert.equal((await submit("alice", { repo: "alice/nothing" })).status, 404);
    const nonsense = await submit("alice", { repo: "not a repository" });
    assert.equal(nonsense.status, 400);
    assert.match(nonsense.error, /github\.com\/owner\/repository/);
  });

  test("the folder has to hold a pack.json that matches the schema, with every file it names", async () => {
    putRepo("alice/empty", { files: { "README.md": "# nothing here" } });
    const none = await submit("alice", { repo: "alice/empty" });
    assert.equal(none.status, 400);
    assert.match(none.error, /No pack\.json/);

    putRepo("alice/broken", { files: { "pack.json": "{ not json" } });
    assert.match((await submit("alice", { repo: "alice/broken" })).error, /not valid JSON/);

    putRepo("alice/wrong", { files: { "pack.json": JSON.stringify({ id: "wrong" }) } });
    const wrong = await submit("alice", { repo: "alice/wrong" });
    assert.equal(wrong.status, 400);
    assert.match(wrong.error, /does not match the pack schema/);

    putRepo("alice/incomplete", { files: tinyPack({ id: "incomplete-pack", drop: ["STYLE.md", "rules/tiny-rule.md"] }) });
    const missing = await submit("alice", { repo: "alice/incomplete" });
    assert.equal(missing.status, 400);
    assert.match(missing.error, /not in the repository: .*STYLE\.md/);
    assert.match(missing.error, /rules\/tiny-rule\.md/, "a rule's own prompt file counts as named");
  });

  test("two names cannot claim the same folder", async () => {
    putRepo("alice/tiny", { files: tinyPack({ id: "renamed-pack" }), stars: 7 });
    const posted = await submit("alice", { repo: "alice/tiny" });
    assert.equal(posted.status, 409);
    assert.match(posted.error, /already registered as tiny-pack/);
    putRepo("alice/tiny", { files: tinyPack(), stars: 7 });
  });
});

describe("updating a pack", () => {
  before(() => {
    putRepo("dave/kit", { files: tinyPack({ id: "dave-kit", version: "1.0.0" }), sha: "d".repeat(40) });
  });

  test("a bumped version in pack.json becomes a new version, and the old one keeps its commit", async () => {
    assert.equal((await submit("dave", { repo: "dave/kit" })).status, 303);
    putRepo("dave/kit", { files: tinyPack({ id: "dave-kit", version: "1.1.0" }), sha: "e".repeat(40) });
    const refreshed = await post("/packs/dave-kit/refresh", "dave");
    assert.equal(refreshed.status, 200);
    assert.match(refreshed.notice, /Version 1\.1\.0 is registered/);

    const { body } = await api("/api/packs/dave-kit");
    assert.equal(body.pack.latest, "1.1.0");
    assert.equal(body.pack.source, `${githubBase}/raw/dave/kit/${"e".repeat(40)}`);
    const old = body.pack.versions.find((v) => v.version === "1.0.0");
    assert.equal(old.sha, "d".repeat(40), "a version stays pinned to the commit it was read at");
  });

  test("the latest is the highest version, not the newest submission", async () => {
    putRepo("dave/kit", { files: tinyPack({ id: "dave-kit", version: "1.0.5" }), sha: "f".repeat(40) });
    await post("/packs/dave-kit/refresh", "dave");
    const { body } = await api("/api/packs/dave-kit");
    assert.equal(body.pack.latest, "1.1.0");
    assert.deepEqual(body.pack.versions.map((v) => v.version), ["1.1.0", "1.0.5", "1.0.0"]);
  });

  test("nothing to do is said plainly, and a version is never re-pinned", async () => {
    putRepo("dave/kit", { files: tinyPack({ id: "dave-kit", version: "1.1.0" }), sha: "e".repeat(40) });
    const same = await post("/packs/dave-kit/refresh", "dave");
    assert.match(same.notice, /No new version/);

    putRepo("dave/kit", { files: tinyPack({ id: "dave-kit", version: "1.1.0" }), sha: "1".repeat(40) });
    const moved = await post("/packs/dave-kit/refresh", "dave");
    assert.equal(moved.status, 409);
    assert.match(moved.notice, /already registered at another commit/);
  });

  test("only its owner updates or removes a pack", async () => {
    const refreshed = await post("/packs/dave-kit/refresh", "eve");
    assert.equal(refreshed.status, 403);
    assert.match(refreshed.notice, /belongs to somebody else/);
    const removed = await post("/packs/dave-kit/remove", "eve");
    assert.equal(removed.status, 403);
    assert.equal((await api("/api/packs/dave-kit")).status, 200, "and it is still listed");
  });

  test("its owner can take it down", async () => {
    const removed = await post("/packs/dave-kit/remove", "dave");
    assert.equal(removed.status, 303);
    assert.equal(removed.location, "/account?removed=1");
    assert.equal((await api("/api/packs/dave-kit")).status, 404);
  });
});

describe("the packs in this repository", () => {
  test("every pack that ships with the product can be registered as it is", async () => {
    const names = (await readdir(packsDir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name).sort();
    assert.ok(names.length >= 3, "the repository ships packs");
    const files = {};
    for (const name of names) {
      for (const rel of await walk(path.join(packsDir, name))) {
        files[`packs/${name}/${rel}`] = await readFile(path.join(packsDir, name, rel), "utf8");
      }
    }
    putRepo("pasho/agentcut", { files, sha: "9".repeat(40), stars: 42 });
    for (const name of names) {
      const posted = await submit("pasho", { repo: "pasho/agentcut", folder: `packs/${name}` });
      assert.equal(posted.status, 303, `${name}: ${posted.error}`);
    }
    const { body } = await api("/api/packs?limit=100");
    for (const name of names) {
      const listed = body.packs.find((p) => p.repo.folder === `packs/${name}`);
      assert.ok(listed, `${name} is listed`);
      assert.equal(listed.source, `${githubBase}/raw/pasho/agentcut/${"9".repeat(40)}/packs/${name}`);
    }
  });
});

async function walk(dir, prefix = "") {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === ".DS_Store") continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...(await walk(path.join(dir, entry.name), rel)));
    else out.push(rel);
  }
  return out;
}

describe("the registry", () => {
  test("lists every pack with its listing shape", async () => {
    const { status, body } = await api("/api/packs");
    assert.equal(status, 200);
    const pack = body.packs.find((p) => p.name === "tiny-pack");
    assert.deepEqual(Object.keys(pack).sort(), [
      "author", "counts", "description", "latest", "name", "owner", "repo", "source", "stars", "title", "updatedAt",
    ]);
    assert.equal(body.headers, undefined);
    assert.equal((await api("/api/packs")).headers.get("access-control-allow-origin"), "*", "the studio reads it from localhost");
  });

  test("q matches name, title and description, and limit caps the list", async () => {
    assert.ok((await api("/api/packs?q=tiny")).body.packs.some((p) => p.name === "tiny-pack"));
    assert.ok((await api("/api/packs?q=for tests")).body.packs.length >= 1, "description matches");
    assert.deepEqual((await api("/api/packs?q=zzzz")).body.packs, []);
    assert.equal((await api("/api/packs?limit=1")).body.packs.length, 1);
  });

  test("an unknown pack is a 404, and nothing else lives under /api", async () => {
    assert.equal((await api("/api/packs/nope")).status, 404);
    assert.equal((await api("/api/me")).status, 404);
    assert.equal((await api("/api/auth/device", { method: "POST" })).status, 404);
  });

  test("no pack bytes are served from here any more", async () => {
    assert.equal((await api(`/r/tiny-pack/1.0.0/pack.json`)).status, 404);
  });
});

describe("pages", () => {
  test("landing, packs, a pack and the submit form render", async () => {
    for (const path of ["/", "/packs", "/packs?q=tiny", "/packs/tiny-pack", "/submit"]) {
      const res = await fetch(url(path));
      assert.equal(res.status, 200, path);
      assert.match(res.headers.get("content-type") ?? "", /text\/html/, path);
      assert.match(await res.text(), /<\/html>/, path);
    }
    assert.equal((await fetch(url("/nope"))).status, 404);
  });

  test("the pack's page shows its repository and escapes the style guide", async () => {
    const html = await (await fetch(url("/packs/tiny-pack"))).text();
    assert.match(html, /github\.com\/alice\/tiny/);
    assert.ok(!html.includes("<script>alert(1)</script>"), "the style guide is text, never markup");
    assert.match(html, /This pack carries code/, "a pack with recipes says so");
    assert.ok(!/Check for updates/.test(html), "a visitor is offered none of the owner's controls");
  });

  test("its owner is offered the two things only they can do", async () => {
    const asOwner = await (await fetch(url("/packs/tiny-pack"), { headers: { "x-dev-login": "alice" } })).text();
    assert.match(asOwner, /Check for updates/);
    assert.match(asOwner, /Remove from the marketplace/);
  });
});
