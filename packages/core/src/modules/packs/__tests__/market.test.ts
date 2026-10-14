/**
 * The marketplace client against a server that speaks apps/web's contract. apps/web's own
 * tests hold the server to it; these hold the CLI, the studio and the agent's side.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

let server: http.Server;
let market: typeof import("../server/market");

const RAW = "https://raw.githubusercontent.com/ana/streamer-kit";
const PACK = {
  name: "streamer-kit", title: "Streamer kit", description: "A look for streams", latest: "1.1.0", author: "Ana",
  owner: { login: "ana", avatarUrl: null }, stars: 12, updatedAt: 1,
  source: `${RAW}/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb`,
  repo: { owner: "ana", name: "streamer-kit", folder: "", branch: "main", url: "https://github.com/ana/streamer-kit" },
  counts: { templates: 1, rules: 0, assets: 0, recipes: 0 },
};
const VERSIONS = [
  { version: "1.0.0", publishedAt: 1, size: 10, sha: "a".repeat(40), source: `${RAW}/${"a".repeat(40)}` },
  { version: "1.1.0", publishedAt: 2, size: 12, sha: "b".repeat(40), source: `${RAW}/${"b".repeat(40)}` },
];

before(async () => {
  server = http.createServer(async (req, res) => {
    const url = new URL(req.url!, "http://x");
    const json = (status: number, value: unknown) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(value));
    if (url.pathname === "/api/packs" && req.method === "GET") {
      return json(200, { packs: url.searchParams.get("q") === "zzz" ? [] : [PACK] });
    }
    if (url.pathname === "/api/packs/streamer-kit") return json(200, { pack: { ...PACK, versions: VERSIONS, manifest: {} } });
    if (url.pathname.startsWith("/api/packs/")) return json(404, { error: "pack not found" });
    json(404, { error: "no route" });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  process.env.AGENTCUT_MARKET = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
  market = await import("../server/market");
});
after(async () => { await new Promise((r) => server.close(r)); });

test("search returns listings whose source is a URL packs.import takes", async () => {
  const packs = await market.searchPacks("kit");
  assert.equal(packs[0].name, "streamer-kit");
  assert.equal(packs[0].stars, 12);
  assert.equal(packs[0].source, PACK.source);
  assert.equal(packs[0].repo.url, "https://github.com/ana/streamer-kit");
  assert.deepEqual(await market.searchPacks("zzz"), []);
});

test("a name resolves to its latest commit, a pinned version to its own, an unknown one is refused with the real ones", async () => {
  assert.equal(await market.marketSource("streamer-kit"), PACK.source);
  assert.equal(await market.marketSource("streamer-kit@1.0.0"), `${RAW}/${"a".repeat(40)}`);
  await assert.rejects(market.marketSource("streamer-kit@3.0.0"), /no version 3\.0\.0\. Listed: 1\.1\.0, 1\.0\.0|no version 3\.0\.0\. Listed: 1\.0\.0, 1\.1\.0/);
  await assert.rejects(market.marketSource("nope"), /pack not found/);
});

test("submitting is a page on the marketplace, with the repository filled in", () => {
  assert.equal(market.submitUrl(), `${market.marketUrl()}/submit`);
  assert.equal(market.submitUrl("ana/streamer-kit"), `${market.marketUrl()}/submit?repo=ana%2Fstreamer-kit`);
});

test("nothing in the client holds a credential", async () => {
  const source = await import("node:fs/promises").then((fs) => fs.readFile(new URL("../server/market.ts", import.meta.url), "utf8"));
  for (const gone of ["credentials", "Bearer", "deviceCode", "publishPack"]) {
    assert.ok(!source.includes(gone), `market.ts still mentions ${gone}`);
  }
});
