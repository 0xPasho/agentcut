import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { Clip, Edl } from "../src/lib/edl";
import { applyOperations } from "../src/lib/editor/operations";
import { sequenceFrames } from "../src/lib/sequences";
import { FFMPEG } from "../src/lib/bin";
let workspace: string;
let store: typeof import("../src/lib/editor/store");
let mediaService: typeof import("../src/lib/editor/media");
let tools: typeof import("../src/lib/editor/tools");
let database: typeof import("../src/lib/db");
let source: string;
before(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agentcut-sequences-"));
  process.env.AGENTCUT_WORKSPACE = workspace;
  [store, mediaService, tools, database] = await Promise.all([import("../src/lib/editor/store"), import("../src/lib/editor/media"), import("../src/lib/editor/tools"), import("../src/lib/db")]);
  source = path.join(workspace, "original.mp4");
  const result = spawnSync(FFMPEG, ["-y", "-f", "lavfi", "-i", "color=red:size=160x90:rate=10:duration=2", "-pix_fmt", "yuv420p", source], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});
after(async () => { database.db.close(); await fs.rm(workspace, { recursive: true, force: true }); });

test("three sources become a local sequence, UI and agent edits hand off without losing work", async () => {
  const { id } = await mediaService.createVideoProject("Three videos", [{ file: source }, { file: source }, { file: source }]);
  const initial = store.readEditor(id);
  assert.equal(initial.edl.media.length, 3);
  const seq = initial.edl.sequences[0];
  assert.equal(seq.items.length, 3);
  assert.equal(sequenceFrames(seq).duration, 60);
  for (const m of initial.edl.media) { assert.notEqual(m.file, source); await fs.access(m.file); }
  const first = seq.items[0];
  const ops = [{ type: "item.move", sequenceId: seq.id, itemId: first.id, index: 2 }, { type: "item.patch", sequenceId: seq.id, itemId: first.id, patch: { start: 0.5, end: 1.5, edits: [{ type: "text", t: 0, d: 1, text: "Hello", position: "center", style: "card" }] } }];
  const expected = applyOperations(initial.edl, ops);
  const { PATCH } = await import("../src/app/api/projects/[id]/route");
  const { NextRequest } = await import("next/server");
  const response = await PATCH(new NextRequest(`http://localhost/api/projects/${id}`, { method: "PATCH", body: JSON.stringify({ expectedRevision: initial.revision, operations: ops }) }), { params: Promise.resolve({ id }) });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).edl, expected);
  await tools.executeEditorTool(id, { tool: "project.edit", expectedRevision: 2, operations: [{ type: "item.split", sequenceId: seq.id, itemId: first.id, at: 0.5, newItemId: "split" }] });
  const split = store.readEditor(id);
  assert.equal(split.edl.sequences[0].items.length, 4);
  assert.equal(split.edl.sequences[0].items[3].clip.edits[0].d, 0.5);
  assert.equal(split.edl.sequences[0].items[3].clip.start, 1);
  assert.equal(sequenceFrames(split.edl.sequences[0]).duration, 50);
  assert.throws(() => store.editProject(id, { expectedRevision: 1, operations: ops }), /changed elsewhere/);
  store.editProject(id, { expectedRevision: 3, operations: [{ type: "sequence.patch", sequenceId: seq.id, title: "Final cut", output: { width: 90, height: 160, fps: 20 } }] });
  assert.equal(store.readEditor(id).edl.sequences[0].items[2].clip.edits[0].type, "text");
});

test("invalid timeline edits roll back; referenced media cannot be removed", async () => {
  const { id } = await mediaService.createVideoProject("Validation", [{ file: source }]);
  const snap = store.readEditor(id), seq = snap.edl.sequences[0], item = seq.items[0];
  const invalid = [
    { type: "item.patch", sequenceId: seq.id, itemId: item.id, patch: { end: 500 } },
    { type: "item.patch", sequenceId: seq.id, itemId: item.id, patch: { start: 0.5 }, before: { start: 1 } },
    { type: "item.move", sequenceId: seq.id, itemId: item.id, index: 4 },
    { type: "item.split", sequenceId: seq.id, itemId: item.id, at: 3, newItemId: "new" },
    { type: "media.remove", mediaId: item.mediaId },
    { type: "item.add", sequenceId: seq.id, item: { ...item, id: "missing", mediaId: "unknown" } },
    { type: "sequence.add", sequence: seq },
  ];
  for (const operation of invalid) {
    await assert.rejects(tools.executeEditorTool(id, { tool: "project.edit", expectedRevision: snap.revision, operations: [{ type: "sequence.patch", sequenceId: seq.id, title: "Must roll back" }, operation] }));
    assert.deepEqual(store.readEditor(id), snap);
  }
  store.editProject(id, { expectedRevision: 1, operations: [{ type: "item.remove", sequenceId: seq.id, itemId: item.id }, { type: "media.remove", mediaId: item.mediaId }] });
  assert.equal(store.readEditor(id).edl.media.length, 0);
});

test("legacy clips remain unchanged and can be reused with their full edit properties", () => {
  const clip = Clip.parse({ id: "legacy", title: "Old clip", start: 0, end: 2, edits: [{ type: "text", t: 0, d: 2, text: "Keep me", position: "top", style: "card" }] });
  const legacy = Edl.parse({ projectId: "old", source: { file: source, width: 160, height: 90, fps: 10, durationSec: 2 }, clips: [clip] });
  const upgraded = applyOperations(legacy, [{ type: "media.add", media: { ...legacy.source, id: "primary", name: "Original" } }, { type: "sequence.add", sequence: { id: "new", title: "New video", output: legacy.output, items: [{ id: "reused", mediaId: "primary", clip }] } }]);
  assert.deepEqual(upgraded.clips, legacy.clips);
  assert.deepEqual(upgraded.sequences[0].items[0].clip, clip);
});

test("media uploads and path imports share validation, revisions and failed-import cleanup", async () => {
  const { id } = await mediaService.createVideoProject("Import", [{ file: source }]);
  const before = store.readEditor(id);
  await tools.executeEditorTool(id, { tool: "media.upload", name: "second.mp4", base64: (await fs.readFile(source)).toString("base64"), expectedRevision: before.revision });
  const folder = path.join(workspace, "projects", id, "media");
  const files = await fs.readdir(folder);
  await assert.rejects(tools.executeEditorTool(id, { tool: "media.import", file: source, expectedRevision: before.revision }), /changed elsewhere/);
  assert.deepEqual(await fs.readdir(folder), files);
  const uploaded = store.readEditor(id);
  assert.equal(uploaded.edl.media.length, 2);
  await assert.rejects(mediaService.importProjectMedia(id, uploaded.revision, { name: "bad.mp4", bytes: Buffer.from("not a video") }));
  assert.deepEqual(await fs.readdir(folder), files);
  assert.deepEqual(store.readEditor(id), uploaded);
});

test("folder tools browse supported media without recursion and import reusable project assets", async () => {
  const originals = await fs.mkdtemp(path.join(os.tmpdir(), "agentcut-chosen-folder-"));
  try {
    await fs.mkdir(path.join(originals, "Footage"));
    await fs.writeFile(path.join(originals, "private.txt"), "not media");
    await fs.writeFile(path.join(originals, ".hidden.png"), "hidden");
    for (let n=0; n<103; n++) await fs.writeFile(path.join(originals, `image-${String(n).padStart(3,"0")}.png`), "fixture");
    await fs.copyFile(source, path.join(originals, "movie.mp4"));
    const a = await mediaService.createVideoProject("Assets A", [{ file: source }]);
    const b = await mediaService.createVideoProject("Assets B", [{ file: source }]);
    const first = await tools.executeEditorTool(a.id, { tool: "assets.browseLocal", folder: originals }) as import("../src/lib/editor/local-assets").FolderListing;
    assert.equal(first.entries.length, 100); assert.equal(first.total, 105); assert.equal(first.nextOffset, 100);
    assert.equal(first.entries[0].kind, "folder");
    assert.ok(!first.entries.some(e=>e.name.startsWith(".") || e.name.endsWith(".txt")));
    const second = await tools.executeEditorTool(a.id, { tool: "assets.browseLocal", folder: originals, offset: 100 }) as typeof first;
    assert.equal(second.entries.length, 5); assert.equal(second.nextOffset, null);
    const original = path.join(originals, "image-000.png");
    const importedA = await tools.executeEditorTool(a.id, { tool: "assets.importLocal", file: original }) as import("../src/lib/db").AssetRow;
    const importedB = await tools.executeEditorTool(b.id, { tool: "assets.importLocal", file: original }) as typeof importedA;
    const concurrent = await Promise.all([a.id, b.id].map(projectId => tools.executeEditorTool(projectId, { tool: "assets.importLocal", file: original })));
    assert.equal((concurrent[0] as typeof importedA).id, (concurrent[1] as typeof importedA).id);
    assert.equal(importedB.id, importedA.id, "identical media is reused");
    const bAssets = await tools.executeEditorTool(b.id, { tool: "assets.list", kind: "image" }) as (typeof importedA)[];
    assert.ok(bAssets.some(asset=>asset.id === importedA.id), "reused asset belongs to both projects");
    const promoted = await tools.executeEditorTool(a.id, { tool: "assets.upload", name: "reusable.png", base64: Buffer.from("fixture").toString("base64") }) as typeof importedA;
    assert.equal(promoted.id, importedA.id); assert.equal(promoted.scope, "library");
    assert.ok(database.q.listAssets("image").some(asset => asset.id === importedA.id));
    await fs.unlink(original);
    assert.equal(await fs.readFile(path.join(workspace, importedA.path), "utf8"), "fixture", "original can be removed without breaking the imported asset");
    await assert.rejects(tools.executeEditorTool(a.id, { tool: "assets.importLocal", file: path.join(originals,"private.txt") }), /Choose an image, audio or video/);
    await assert.rejects(tools.executeEditorTool(a.id, { tool: "assets.browseLocal", folder: path.join(originals,"missing") }));
  } finally { await fs.rm(originals, { recursive: true, force: true }); }
});

test("an empty project opens the same editor with no source, and imports never become one", async () => {
  const { id } = await mediaService.createVideoProject("Empty canvas");
  const initial = store.readEditor(id);
  assert.equal(initial.edl.source, null);
  assert.deepEqual(initial.edl.media, []);
  assert.deepEqual(initial.edl.clips, []);
  assert.equal(initial.edl.sequences.length, 1);
  assert.equal(initial.edl.sequences[0].title, "Main video");
  assert.deepEqual(initial.edl.sequences[0].items, []);
  assert.deepEqual(initial.edl.sequences[0].output, { width: 1920, height: 1080, fps: 30 });
  assert.equal(database.q.getProject(id)!.source_path, "", "no primary source is an empty source path");
  await assert.rejects(tools.executeEditorTool(id, { tool: "assets.capture", atSec: 0 }), /no source video/);
  await tools.executeEditorTool(id, { tool: "media.import", file: source, expectedRevision: initial.revision });
  const imported = store.readEditor(id);
  assert.equal(imported.edl.media.length, 1);
  assert.equal(imported.edl.source, null, "imported media stays in media[], independent of the primary source");
  assert.equal(database.q.getProject(id)!.source_path, "");
  const captured = await tools.executeEditorTool(id, { tool: "assets.capture", atSec: 0.5, mediaId: imported.edl.media[0].id }) as { path: string };
  await fs.access(path.join(workspace, captured.path));
  assert.throws(() => store.editProject(id, { expectedRevision: imported.revision, operations: [{ type: "clip.add", clip: Clip.parse({ id: "nosource", title: "No source", start: 0, end: 1 }) }] }), /source video/);
  assert.deepEqual(store.readEditor(id), imported);
});

test("the assemble endpoint accepts a name alone, a file list, or neither validly", async () => {
  const { POST } = await import("../src/app/api/projects/assemble/route");
  const { NextRequest } = await import("next/server");
  const assemble = (body: unknown) => POST(new NextRequest("http://localhost/api/projects/assemble", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
  const empty = await assemble({ name: "From the API" });
  assert.equal(empty.status, 200);
  const blank = store.readEditor((await empty.json()).id).edl;
  assert.equal(blank.source, null); assert.deepEqual(blank.media, []); assert.equal(blank.sequences.length, 1);
  const withFile = await assemble({ name: "With a file", files: [source] });
  assert.equal(withFile.status, 200);
  const assembled = store.readEditor((await withFile.json()).id).edl;
  assert.equal(assembled.media.length, 1);
  assert.equal(assembled.source?.file, assembled.media[0].file, "supplied footage still becomes the primary source");
  assert.equal((await assemble({ name: "Bad", files: [7] })).status, 400);

  // The shape chosen on the home screen is the video's, not the footage's: someone who
  // picked "vertical" and then dropped a landscape clip in meant the vertical.
  const vertical = await assemble({ name: "Vertical", aspect: "9:16", files: [source] });
  assert.equal(vertical.status, 200);
  const shaped = store.readEditor((await vertical.json()).id).edl;
  assert.deepEqual(shaped.output, { width: 1080, height: 1920, fps: 30 });
  assert.deepEqual(shaped.sequences[0].output, { width: 1080, height: 1920, fps: 30 });
  assert.notDeepEqual(shaped.media[0].width, 1080, "the source itself is untouched");
  // An unknown shape is ignored rather than refused: it is a preference, not a command.
  const odd = await assemble({ name: "Odd", aspect: "banana" });
  assert.equal(odd.status, 200);
  assert.deepEqual(store.readEditor((await odd.json()).id).edl.output, { width: 1920, height: 1080, fps: 30 });
});

test("canvas segments are ordinary shots without a source, through HTTP and tools alike", async () => {
  const { id } = await mediaService.createVideoProject("Canvas");
  const initial = store.readEditor(id), seq = initial.edl.sequences[0];
  const card = { id: "canvas_title", clip: Clip.parse({ id: "canvas_title", title: "Title card", start: 0, end: 3, captions: { preset: "none" }, edits: [{ type: "text", t: 0, d: 3, text: "Chapter one" }] }) };
  const operations = [{ type: "item.add", sequenceId: seq.id, item: card }];
  const expected = applyOperations(initial.edl, operations);
  assert.equal(expected.sequences[0].items[0].mediaId, null, "an omitted media reference is a canvas segment");
  assert.equal(sequenceFrames(expected.sequences[0]).duration, 90);
  const { PATCH } = await import("../src/app/api/projects/[id]/route"); const { NextRequest } = await import("next/server");
  const response = await PATCH(new NextRequest(`http://localhost/api/projects/${id}`, { method: "PATCH", body: JSON.stringify({ expectedRevision: initial.revision, operations }) }), { params: Promise.resolve({ id }) });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).edl, expected);
  const { assetEdit } = await import("../src/lib/editor/asset-edit");
  await tools.executeEditorTool(id, { tool: "project.edit", expectedRevision: 2, operations: [
    { type: "item.add", sequenceId: seq.id, item: { id: "canvas_outro", mediaId: null, clip: Clip.parse({ id: "canvas_outro", title: "Outro", start: 0, end: 2 }) } },
    { type: "item.move", sequenceId: seq.id, itemId: "canvas_outro", index: 0 },
    { type: "item.patch", sequenceId: seq.id, itemId: "canvas_title", patch: { end: 600 } },
    { type: "item.edit.add", sequenceId: seq.id, itemId: "canvas_outro", edit: assetEdit({ id: "song", kind: "audio" }, 0, 2) },
    { type: "item.split", sequenceId: seq.id, itemId: "canvas_title", at: 2, newItemId: "canvas_title_b" },
  ] });
  const saved = store.readEditor(id);
  const items = saved.edl.sequences[0].items;
  assert.deepEqual(items.map(i => i.id), ["canvas_outro", "canvas_title", "canvas_title_b"]);
  assert.deepEqual(items.map(i => i.mediaId), [null, null, null]);
  assert.equal(items[2].clip.end, 600, "a canvas segment is not bound to a source duration it does not have");
  assert.equal(items[0].clip.edits[0].type, "music");
  assert.equal(saved.edl.media.length, 0);
  const invalid = [
    { type: "item.add", sequenceId: seq.id, item: { id: "backwards", mediaId: null, clip: Clip.parse({ id: "backwards", title: "Bad timing", start: 2, end: 2 }) } },
    { type: "item.add", sequenceId: seq.id, item: { id: "oversized", mediaId: null, clip: Clip.parse({ id: "oversized", title: "Bad framing", start: 0, end: 1, crop: [{ t: 0, x: 0, y: 0, w: 5000, h: 5000 }] }) } },
    { type: "item.add", sequenceId: seq.id, item: { id: "ghost", mediaId: "unknown", clip: Clip.parse({ id: "ghost", title: "Missing media", start: 0, end: 1 }) } },
  ];
  for (const operation of invalid) {
    await assert.rejects(tools.executeEditorTool(id, { tool: "project.edit", expectedRevision: saved.revision, operations: [{ type: "sequence.patch", sequenceId: seq.id, title: "Must roll back" }, operation] }));
    assert.deepEqual(store.readEditor(id), saved);
  }
});

test("asset placement appends to the same shot through HTTP and tools without replacing other edits", async () => {
  const { id } = await mediaService.createVideoProject("Asset placement", [{ file: source }]);
  const initial = store.readEditor(id), sequence = initial.edl.sequences[0], item = sequence.items[0];
  const { assetEdit } = await import("../src/lib/editor/asset-edit");
  const operations = [{ type: "item.edit.add", sequenceId: sequence.id, itemId: item.id, edit: assetEdit({ id: "picture", kind: "image" }, 0.5, 2) }];
  const { PATCH } = await import("../src/app/api/projects/[id]/route"); const { NextRequest } = await import("next/server");
  const response = await PATCH(new NextRequest(`http://localhost/api/projects/${id}`, { method: "PATCH", body: JSON.stringify({ expectedRevision: initial.revision, operations }) }), { params: Promise.resolve({ id }) });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).edl, applyOperations(initial.edl, operations));
  await tools.executeEditorTool(id, { tool: "project.edit", expectedRevision: 2, operations: [{ type: "item.edit.add", sequenceId: sequence.id, itemId: item.id, edit: assetEdit({ id: "song", kind: "audio" }, 0, 2) }] });
  const saved = store.readEditor(id).edl.sequences[0].items[0].clip.edits;
  assert.deepEqual(saved.map(e=>e.type), ["image", "music"]); assert.equal(saved[0].t, 0.5);
});

test("transitions are one editor: HTTP and agent write the same joint, and a bad one rolls the batch back", async () => {
  const { id } = await mediaService.createVideoProject("Dissolves", [{ file: source }, { file: source }, { file: source }]);
  const initial = store.readEditor(id), seq = initial.edl.sequences[0];
  for (const item of seq.items) assert.equal("transition" in item, false, "an ordinary import has hard cuts and says nothing about transitions");
  const { PATCH } = await import("../src/app/api/projects/[id]/route");
  const { NextRequest } = await import("next/server");
  const human = [{ type: "item.transition", sequenceId: seq.id, itemId: seq.items[1].id, transition: { kind: "dissolve", durationSec: 0.4 } }];
  const response = await PATCH(new NextRequest(`http://localhost/api/projects/${id}`, { method: "PATCH", body: JSON.stringify({ expectedRevision: initial.revision, operations: human }) }), { params: Promise.resolve({ id }) });
  assert.equal(response.status, 200);
  const ui = await response.json() as { edl: typeof initial.edl; revision: number };
  assert.deepEqual(ui.edl, applyOperations(initial.edl, human));
  assert.equal(sequenceFrames(ui.edl.sequences[0]).duration, 56, "three one-second shots minus a 0.4s overlap");
  // The agent continues the human's edit through the same operation and the same validation.
  const agentOps = [{ type: "item.transition", sequenceId: seq.id, itemId: seq.items[2].id, transition: { kind: "wipe", durationSec: 0.3, direction: "up", by: "agent:7" } }];
  const agent = await tools.executeEditorTool(id, { tool: "project.edit", expectedRevision: ui.revision, operations: agentOps }) as { edl: typeof initial.edl; revision: number };
  assert.deepEqual(agent.edl, applyOperations(ui.edl, agentOps));
  assert.equal(agent.edl.sequences[0].items[2].transition!.by, "agent:7", "why is this here survives the round trip");
  assert.equal(sequenceFrames(agent.edl.sequences[0]).duration, 53);
  // The identical HTTP request refuses the identical impossible joint.
  const refused = { type: "item.transition", sequenceId: seq.id, itemId: seq.items[0].id, transition: { kind: "dip", durationSec: 0.5 } };
  const bad = await PATCH(new NextRequest(`http://localhost/api/projects/${id}`, { method: "PATCH", body: JSON.stringify({ expectedRevision: agent.revision, operations: [{ type: "sequence.patch", sequenceId: seq.id, title: "Must roll back" }, refused] }) }), { params: Promise.resolve({ id }) });
  assert.equal(bad.status, 400);
  await assert.rejects(tools.executeEditorTool(id, { tool: "project.edit", expectedRevision: agent.revision, operations: [refused] }), /first shot on its track/);
  assert.deepEqual(store.readEditor(id), agent, "nothing in the refused batch landed");
});

test("a saved timeline of hard cuts stays free of transitions, and an old EDL still parses", () => {
  const legacy = Edl.parse({ projectId: "old", source: null, clips: [], sequences: [{ id: "s", title: "Old", output: { width: 640, height: 360, fps: 10 },
    items: [{ id: "a", mediaId: null, clip: { id: "a", title: "A", start: 0, end: 2 } }, { id: "b", mediaId: null, clip: { id: "b", title: "B", start: 0, end: 2 } }] }] });
  assert.equal(sequenceFrames(legacy.sequences[0]).duration, 40);
  assert.equal(JSON.stringify(legacy).includes("transition"), false, "reading an old EDL does not write a migration into it");
  const edited = applyOperations(legacy, [{ type: "item.patch", sequenceId: "s", itemId: "b", patch: { title: "B again" } }]);
  assert.equal(JSON.stringify(edited).includes("transition"), false);
  assert.deepEqual(sequenceFrames(edited.sequences[0]).items.map(i => i.from), [0, 20]);
});
