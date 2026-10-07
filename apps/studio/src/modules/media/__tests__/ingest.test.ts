import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { Readable } from "node:stream";
import { NextRequest } from "next/server";
import { FFMPEG } from "@agentcut/core/common/server/bin";

/**
 * Decision 137: a file from this computer is cloned, a drop is resolved to its path
 * first, and bytes the machine does not have are streamed, never buffered.
 */
let workspace: string;
let outside: string;
let source: string;
let picture: string;
let ingest: typeof import("@agentcut/core/modules/media/server/ingest");
let database: typeof import("@agentcut/core/common/server/db");
let assets: typeof import("@agentcut/core/modules/media/server/assets");
let mediaService: typeof import("@agentcut/core/modules/media/server/media-import");
let create: typeof import("@agentcut/core/modules/project/server/create");

before(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agentcut-ingest-"));
  outside = await fs.mkdtemp(path.join(os.tmpdir(), "agentcut-downloads-"));
  process.env.AGENTCUT_WORKSPACE = workspace;
  [ingest, database, assets, mediaService, create] = await Promise.all([
    import("@agentcut/core/modules/media/server/ingest"), import("@agentcut/core/common/server/db"), import("@agentcut/core/modules/media/server/assets"), import("@agentcut/core/modules/media/server/media-import"), import("@agentcut/core/modules/project/server/create"),
  ]);
  source = path.join(outside, "stream night.mp4");
  const made = spawnSync(FFMPEG, ["-y", "-f", "lavfi", "-i", "color=navy:size=320x180:rate=15:duration=2", "-f", "lavfi", "-i", "sine=frequency=300:duration=2", "-pix_fmt", "yuv420p", "-shortest", source], { encoding: "utf8" });
  assert.equal(made.status, 0, made.stderr);
  picture = path.join(outside, "logo.png");
  const png = spawnSync(FFMPEG, ["-y", "-f", "lavfi", "-i", "color=orange:size=64x64", "-frames:v", "1", picture], { encoding: "utf8" });
  assert.equal(png.status, 0, png.stderr);
});
after(async () => { database.db.close(); await fs.rm(workspace, { recursive: true, force: true }); await fs.rm(outside, { recursive: true, force: true }); });

const fingerprint = async (file: string) => { const stat = await fs.stat(file); return { name: path.basename(file), size: stat.size, modifiedAt: Math.round(stat.mtimeMs) }; };
const same = async (a: string, b: string) => assert.deepEqual(await fs.readFile(a), await fs.readFile(b));

test("a clone has the original's bytes and leaves the original where it was", async () => {
  const target = path.join(workspace, "clone.mp4");
  await ingest.cloneFile(source, target);
  await same(source, target);
  assert.ok((await fs.stat(source)).isFile(), "the original is still there");
});

test("a dropped file is found from its name, size and date, and only then", async () => {
  const print = await fingerprint(source);
  const found = await ingest.resolveLocalFile(print, { roots: [outside], workspace });
  assert.equal(found?.file, path.resolve(source));
  assert.equal(found?.kind, "video");
  assert.equal(await ingest.resolveLocalFile({ ...print, size: print.size + 1 }, { roots: [outside], workspace }), null, "a different size is a different file");
  assert.equal(await ingest.resolveLocalFile({ ...print, modifiedAt: print.modifiedAt + 60_000 }, { roots: [outside], workspace }), null, "a different date is a different file");
  assert.equal(await ingest.resolveLocalFile({ ...print, name: "notes.txt" }, { roots: [outside], workspace }), null, "not media, not resolved");
  // A clone already inside the workspace is not the original anyone dropped.
  const inside = path.join(workspace, "inside.mp4");
  await ingest.cloneFile(source, inside);
  await fs.utimes(inside, new Date(print.modifiedAt), new Date(print.modifiedAt));
  const insidePrint = { ...print, name: "inside.mp4" };
  assert.equal(await ingest.resolveLocalFile(insidePrint, { roots: [workspace], workspace }), null);
});

test("the fingerprint is read strictly: name, a positive size and a positive time", () => {
  assert.equal(ingest.fingerprintOf({ name: "a.mp4", size: 10, modifiedAt: 5 })?.name, "a.mp4");
  assert.equal(ingest.fingerprintOf({ name: "../../a.mp4", size: 10, modifiedAt: 5 })?.name, "a.mp4", "a path in the name is just a name");
  assert.equal(ingest.fingerprintOf({ name: "a.mp4", size: 0, modifiedAt: 5 }), null);
  assert.equal(ingest.fingerprintOf({ name: "", size: 10, modifiedAt: 5 }), null);
  assert.equal(ingest.fingerprintOf({ name: "a.mp4", size: "big", modifiedAt: 5 }), null);
});

test("a new project from a local path keeps its own clone, so the original can move", async () => {
  const created = await create.createFromSource(source);
  assert.ok("id" in created, JSON.stringify(created));
  const row = database.q.getProject(created.id)!;
  assert.ok(row.source_path.startsWith(path.join(workspace, "projects", created.id)), row.source_path);
  assert.equal(row.name, "stream night.mp4");
  await same(source, row.source_path);
  const missing = await create.createFromSource(path.join(outside, "nope.mp4"));
  assert.ok("error" in missing);
});

test("a video the browser could not name streams into the project as the raw body", async () => {
  const { POST } = await import("../../../app/api/projects/[id]/media/route");
  const project = await mediaService.createVideoProject("Streamed");
  const revision = database.q.getProject(project.id)!.revision;
  const bytes = await fs.readFile(source);
  const req = new NextRequest(`http://localhost/api/projects/${project.id}/media`, {
    method: "POST",
    headers: { "content-type": "video/mp4", "x-file-name": encodeURIComponent("dropped.mp4"), "x-expected-revision": String(revision), "x-transcribe": "false" },
    body: Readable.toWeb(Readable.from([bytes.subarray(0, 1000), bytes.subarray(1000)])) as unknown as ReadableStream,
    // Node needs this for a streaming body; the typed init does not know the field.
    ...({ duplex: "half" } as object),
  });
  const response = await POST(req, { params: Promise.resolve({ id: project.id }) });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  const media = body.edl.media.at(-1);
  assert.equal(media.name, "dropped.mp4");
  await same(source, media.file);
  assert.equal(media.transcription.status, "skipped");
});

test("an asset arrives by path as a clone, or as a streamed body, into the project or the library", async () => {
  const { POST } = await import("../../../app/api/assets/route");
  const project = await mediaService.createVideoProject("Assets");
  const byPath = await POST(new NextRequest(`http://localhost/api/assets?projectId=${project.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ file: picture }) }));
  const cloned = (await byPath.json()).asset;
  assert.equal(byPath.status, 200, JSON.stringify(cloned));
  assert.equal(cloned.scope, "project");
  assert.equal(cloned.project_id, project.id);
  assert.equal(cloned.name, "logo.png");
  await same(picture, assets.toAbs(cloned.path));

  const bytes = await fs.readFile(picture);
  const streamed = await POST(new NextRequest("http://localhost/api/assets", {
    method: "POST", headers: { "content-type": "image/png", "x-file-name": encodeURIComponent("pasted.png") },
    body: Readable.toWeb(Readable.from([bytes])) as unknown as ReadableStream,
    // Node needs this for a streaming body; the typed init does not know the field.
    ...({ duplex: "half" } as object),
  }));
  const library = (await streamed.json()).asset;
  assert.equal(streamed.status, 200, JSON.stringify(library));
  assert.equal(library.scope, "library");
  // Same bytes, already registered: the row is reused and the fresh file is not kept.
  assert.equal(library.id, cloned.id);
  assert.equal((await fs.readdir(assets.libraryDirFor("image"))).filter(f => f.includes("pasted")).length, 0);

  const refused = await POST(new NextRequest("http://localhost/api/assets", { method: "POST", headers: { "content-type": "text/plain", "x-file-name": "notes.txt" }, body: "hello" }));
  assert.equal(refused.status, 400);
});

test("what a file is, is answered once for the browser and the server", async () => {
  const { classifyFile } = await import("@agentcut/core/common/lib/files");
  for (const name of ["a.avi", "b.bmp", "c.opus", "d.mp4", "e.svg", "f.flac"]) assert.equal(assets.kindFor(name), classifyFile(name), name);
  assert.equal(assets.kindFor("a.avi"), "video");
  assert.equal(classifyFile("notes.txt"), null);
});

test("a video attached to a project's chat is that project's asset, and media.import places it by id without a second clone", async () => {
  const { POST } = await import("../../../app/api/assets/route");
  const tools = await import("@agentcut/core/modules/editor/server/tools");
  const project = await mediaService.createVideoProject("Attached");
  const response = await POST(new NextRequest(`http://localhost/api/assets?projectId=${project.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ file: source }) }));
  const asset = (await response.json()).asset;
  assert.equal(response.status, 200, JSON.stringify(asset));
  assert.equal(asset.kind, "video");
  assert.equal(asset.scope, "project");
  const revision = database.q.getProject(project.id)!.revision;
  const { edl } = await tools.executeEditorTool(project.id, { tool: "media.import", file: asset.id, expectedRevision: revision, transcribe: false }) as { edl: { media: Array<{ file: string }> } };
  assert.equal(path.resolve(edl.media.at(-1)!.file), path.resolve(assets.toAbs(asset.path)), "referenced where it is, not cloned again");
});
