/**
 * The marketplace client against a server that speaks apps/web's contract. apps/web's own
 * tests hold the server to it; these hold the CLI, the studio and the agent's side.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

let dir: string;
let server: http.Server;
let market: typeof import("../server/market");
let pendingPolls = 0;
const published: Array<{ auth: string | undefined; files: Array<{ path: string; base64: string }> }> = [];
const PACK = {
  name: "streamer-kit", title: "Streamer kit", description: "A look for streams", latest: "1.1.0", author: "Ana",
  owner: { login: "ana", avatarUrl: null }, downloads: 4, updatedAt: 1, source: "", counts: { templates: 1, rules: 0, assets: 0, recipes: 0 },
};

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "agentcut-market-"));
  server = http.createServer(async (req, res) => {
    const url = new URL(req.url!, "http://x");
    let body = "";
    for await (const chunk of req) body += chunk;
    const json = (status: number, value: unknown) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(value));
    const source = `${process.env.AGENTCUT_MARKET!.replace(/\/$/, "")}/r/streamer-kit/1.1.0`;
    if (url.pathname === "/api/packs" && req.method === "GET") return json(200, { packs: url.searchParams.get("q") === "zzz" ? [] : [{ ...PACK, source }] });
    if (url.pathname === "/api/packs/streamer-kit") return json(200, { pack: { ...PACK, source, versions: [{ version: "1.0.0", publishedAt: 1, size: 1 }, { version: "1.1.0", publishedAt: 2, size: 1 }], manifest: {} } });
    if (url.pathname.startsWith("/api/packs/")) return json(404, { error: "pack not found" });
    if (url.pathname === "/api/auth/device") return json(200, { deviceCode: "dev-123", userCode: "ABCD-EFGH", verificationUrl: "http://x/device?code=ABCD-EFGH", interval: 0, expiresIn: 30 });
    if (url.pathname === "/api/auth/token") {
      if (JSON.parse(body).deviceCode !== "dev-123") return json(404, { error: "unknown" });
      if (pendingPolls-- > 0) return json(428, { error: "authorization_pending" });
      return json(200, { token: "tok-1", user: { login: "ana", name: "Ana", avatarUrl: null } });
    }
    if (url.pathname === "/api/me") return req.headers.authorization === "Bearer tok-1" ? json(200, { user: { login: "ana", name: "Ana", avatarUrl: null } }) : json(401, { error: "signed out" });
    if (url.pathname === "/api/packs" && req.method === "POST") {
      published.push({ auth: req.headers.authorization, files: JSON.parse(body).files });
      return json(201, { name: "streamer-kit", version: "1.2.0", url: "u", source: "s" });
    }
    json(404, { error: "no route" });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  process.env.AGENTCUT_MARKET = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
  process.env.AGENTCUT_HOME = path.join(dir, "home");
  market = await import("../server/market");
});
after(async () => { await new Promise((r) => server.close(r)); fs.rmSync(dir, { recursive: true, force: true }); });

test("search returns listings whose source is a URL packs.import takes", async () => {
  const packs = await market.searchPacks("kit");
  assert.equal(packs[0].name, "streamer-kit");
  assert.equal(packs[0].source, `${market.marketUrl()}/r/streamer-kit/1.1.0`);
  assert.deepEqual(await market.searchPacks("zzz"), []);
});

test("a name resolves to its latest version, a pinned version to itself, an unknown one is refused with the real ones", async () => {
  assert.equal(await market.marketSource("streamer-kit"), `${market.marketUrl()}/r/streamer-kit/1.1.0`);
  assert.equal(await market.marketSource("streamer-kit@1.0.0"), `${market.marketUrl()}/r/streamer-kit/1.0.0`);
  await assert.rejects(market.marketSource("streamer-kit@3.0.0"), /no version 3\.0\.0\. Published: 1\.0\.0, 1\.1\.0/);
  await assert.rejects(market.marketSource("nope"), /pack not found/);
});

test("login waits for the browser, then keeps the token for this marketplace only, readable by its owner", async () => {
  assert.equal(await market.whoami(), null);
  pendingPolls = 2;
  const login = await market.startLogin();
  assert.equal(login.userCode, "ABCD-EFGH");
  const user = await market.finishLogin(login, { sleep: async () => {} });
  assert.equal(user.login, "ana");
  assert.equal(pendingPolls, -1, "it polled through both pending answers");
  const file = path.join(process.env.AGENTCUT_HOME!, "credentials.json");
  if (process.platform !== "win32") assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(file, "utf8"))), [market.marketUrl()]);
  assert.equal((await market.whoami())?.login, "ana");
});

test("publishing checks the folder first, then sends every file with the token", async () => {
  const pack = path.join(dir, "kit");
  fs.mkdirSync(path.join(pack, "templates"), { recursive: true });
  fs.writeFileSync(path.join(pack, "pack.json"), JSON.stringify({ id: "streamer-kit", name: "Streamer kit", version: "1.2.0", templates: ["look"], style: "STYLE.md" }));
  fs.writeFileSync(path.join(pack, "templates", "look.json"), "{}");
  await assert.rejects(market.packForPublish(pack), /names files that are not in .*: STYLE\.md/);
  fs.writeFileSync(path.join(pack, "STYLE.md"), "# Look\n");
  fs.writeFileSync(path.join(pack, ".DS_Store"), "junk");
  const result = await market.publishPack(pack);
  assert.equal(result.version, "1.2.0");
  const sent = published.at(-1)!;
  assert.equal(sent.auth, "Bearer tok-1");
  assert.deepEqual(sent.files.map((f) => f.path).sort(), ["STYLE.md", "pack.json", "templates/look.json"], "hidden files stay home");
  assert.equal(Buffer.from(sent.files.find((f) => f.path === "STYLE.md")!.base64, "base64").toString(), "# Look\n");
});

test("signed out, publishing says how to sign in", async () => {
  assert.equal(await market.logout(), true);
  await assert.rejects(market.publishPack(path.join(dir, "kit")), /Run agentcut login first/);
});
