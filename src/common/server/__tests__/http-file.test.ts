import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileResponse } from "../http-file";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agentcut-http-"));
const file = path.join(dir, "clip.mp4");
fs.writeFileSync(file, Buffer.alloc(9_000, 7));

const head = (h: Record<string, string>) => new Headers(h);

test("a served file carries a validator, so a second video element can reuse it", async () => {
  const res = await fileResponse(file, head({ range: "bytes=0-" }));
  assert.equal(res.status, 206);
  const tag = res.headers.get("etag");
  assert.ok(tag, "a range response without a validator is a range no cache may keep");
  assert.match(res.headers.get("cache-control") ?? "", /no-cache/, "a freshness window would serve a re-rendered clip from the old bytes");
  assert.equal(res.headers.get("content-range"), "bytes 0-8999/9000");
  await res.arrayBuffer();
});

test("the validator changes when the file underneath does", async () => {
  const before = (await fileResponse(file, null)).headers.get("etag");
  fs.writeFileSync(file, Buffer.alloc(12_000, 9));
  const after = (await fileResponse(file, null)).headers.get("etag");
  assert.notEqual(before, after, "a re-ingested source must never be served from the old cache");
  fs.writeFileSync(file, Buffer.alloc(9_000, 7));
});

test("a cache asking whether it is still current is answered with a header, not a chunk", async () => {
  const tag = (await fileResponse(file, null)).headers.get("etag")!;
  const res = await fileResponse(file, head({ "if-none-match": tag, range: "bytes=0-99" }));
  assert.equal(res.status, 304);
  assert.equal(res.body, null);
});

test("a range asked against a file that has since changed comes back whole", async () => {
  const res = await fileResponse(file, head({ range: "bytes=100-199", "if-range": '"stale-tag"' }));
  assert.equal(res.status, 200, "splicing a piece of the new file into a cached piece of the old one is not an answer");
  assert.equal(res.headers.get("content-length"), "9000");
  await res.arrayBuffer();
});

test("a range asked against the file it was cached from is still a range", async () => {
  const tag = (await fileResponse(file, null)).headers.get("etag")!;
  const res = await fileResponse(file, head({ range: "bytes=100-199", "if-range": tag }));
  assert.equal(res.status, 206);
  assert.equal(res.headers.get("content-range"), "bytes 100-199/9000");
  await res.arrayBuffer();
});

test("the last N bytes means the last N bytes, which is where an mp4 keeps its index", async () => {
  const res = await fileResponse(file, head({ range: "bytes=-500" }));
  assert.equal(res.status, 206);
  assert.equal(res.headers.get("content-range"), "bytes 8500-8999/9000", "a suffix range served from byte zero sends the reader looking again");
  assert.equal((await res.arrayBuffer()).byteLength, 500);
});

test("a range with no bytes in it is said to be unsatisfiable rather than crashing", async () => {
  for (const range of ["bytes=9000-9100", "bytes=500-100"]) {
    const res = await fileResponse(file, head({ range }));
    assert.equal(res.status, 416, range);
    assert.equal(res.headers.get("content-range"), "bytes */9000");
  }
});
