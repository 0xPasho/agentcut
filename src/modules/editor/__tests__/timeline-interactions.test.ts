import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Clip, Edl } from "../types";
import { applyOperations } from "../lib/operations";
import { buildTimelineMove, buildTimelineTrim } from "../lib/timeline-interactions";
import { sequenceFrames } from "../lib/sequences";
const fixture = () => Edl.parse({ projectId: "test", source: null, media: [{ id: "source", name: "Source", file: "/tmp/source.mp4", width: 640, height: 360, fps: 10, durationSec: 20 }], clips: [], sequences: [{ id: "main", title: "Main", output: { width: 640, height: 360, fps: 10 }, items: [
  { id: "a", mediaId: "source", clip: Clip.parse({ title: "Test", id: "a", start: 2, end: 6 }) },
  { id: "b", mediaId: "source", clip: Clip.parse({ title: "Test", id: "b", start: 0, end: 3 }) },
  { id: "overlay", layer: 2, at: 1, mediaId: null, clip: Clip.parse({ title: "Test", id: "overlay", start: 0, end: 8, edits: [{ type: "text", t: 0, d: 8, text: "Title" }] }) },
  { id: "overlay2", layer: 2, mediaId: null, clip: Clip.parse({ title: "Test", id: "overlay2", start: 0, end: 2 }) },
] }] });
const starts = (edl: Edl) => Object.fromEntries(sequenceFrames(edl.sequences[0]).items.map(i => [i.item.id, i.from / 10]));
const reorder = (itemId: string, layer: number, index: number) => ({ type: "item.reorder", sequenceId: "main", itemId, layer, index });
test("chronological reorder packs main footage and freezes unrelated automatic overlays", () => {
  const initial = fixture();
  const next = applyOperations(initial, [reorder("b", 0, 0)]);
  assert.deepEqual(starts(next), { overlay: 1, overlay2: 9, b: 0, a: 3 });
  assert.deepEqual(next.sequences[0].items.find(i => i.id === "a")!.clip, initial.sequences[0].items[0].clip);
  const moved = applyOperations(next, [reorder("b", 1, 0)]);
  assert.deepEqual(starts(moved), { overlay: 1, overlay2: 9, a: 0, b: 0 });
  assert.throws(() => applyOperations(initial, [reorder("a", 0, 2)]), /outside/);
});
test("source trimming clamps bounds, ripples main track, preserves overlays and rejects stale edits", () => {
  const initial = fixture(), seq = initial.sequences[0];
  const ops = buildTimelineTrim(seq, "a", "start", 1, initial.media);
  const next = applyOperations(initial, ops);
  assert.equal(next.sequences[0].items.find(i => i.id === "a")!.clip.start, 3);
  assert.deepEqual(starts(next), { overlay: 1, overlay2: 9, a: 0, b: 3 });
  assert.throws(() => applyOperations(next, ops), /changed/);
  const extended = applyOperations(initial, buildTimelineTrim(seq, "a", "end", 100, initial.media));
  assert.equal(extended.sequences[0].items.find(i => i.id === "a")!.clip.end, 20);
  const shortened = applyOperations(initial, buildTimelineTrim(seq, "a", "end", -100, initial.media));
  assert.ok(Math.abs(shortened.sequences[0].items.find(i => i.id === "a")!.clip.end - 2.1) < 0.001);
});
test("trim movement maps through removed silence and left overlay trim preserves its right edge", () => {
  const initial = fixture(), seq = initial.sequences[0];
  seq.items[0].clip = Clip.parse({ title: "Test", id: "a", start: 2, end: 10, edits: [{ type: "silence", t: 1, d: 2 }] });
  seq.items[0].layer = 1; seq.items[0].at = 4;
  const left = applyOperations(initial, buildTimelineTrim(seq, "a", "start", 2, initial.media));
  const item = left.sequences[0].items.find(i => i.id === "a")!;
  assert.equal(item.clip.start, 6);
  assert.equal(item.at, 6);
  const right = applyOperations(initial, buildTimelineTrim(seq, "a", "end", -5, initial.media));
  assert.equal(right.sequences[0].items.find(i => i.id === "a")!.clip.end, 3);
});
test("canvas title duration grows with its edge", () => {
  const initial = fixture();
  const next = applyOperations(initial, buildTimelineTrim(initial.sequences[0], "overlay", "end", 2, initial.media));
  const clip = next.sequences[0].items.find(i => i.id === "overlay")!.clip;
  assert.equal(clip.end, 10); assert.equal(clip.edits[0].d, 10);
});
let workspace: string;
let store: typeof import("../server/store");
let tools: typeof import("../server/tools");
let database: typeof import("../../../common/server/db");
before(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agentcut-timeline-"));
  process.env.AGENTCUT_WORKSPACE = workspace;
  [store, tools, database] = await Promise.all([import("../server/store"), import("../server/tools"), import("../../../common/server/db")]);
});
after(async () => { database.db.close(); await fs.rm(workspace, { recursive: true, force: true }); });
test("HTTP and tool reorder/trim handoffs persist identical state and invalid insertion rolls back", async () => {
  const { createVideoProject } = await import("../../media/server/media-import");
  const { id } = await createVideoProject("Timeline");
  let snapshot = store.readEditor(id);
  const desired = fixture();
  store.editProject(id, { expectedRevision: snapshot.revision, operations: [{ type: "media.add", media: desired.media[0] }, { type: "sequence.add", sequence: desired.sequences[0] }] });
  snapshot = store.readEditor(id);
  const operations = [reorder("b", 0, 0)];
  const expected = applyOperations(snapshot.edl, operations);
  const { PATCH } = await import("../../../app/api/projects/[id]/route");
  const { NextRequest } = await import("next/server");
  const response = await PATCH(new NextRequest(`http://localhost/api/projects/${id}`, { method: "PATCH", body: JSON.stringify({ expectedRevision: snapshot.revision, operations }) }), { params: Promise.resolve({ id }) });
  assert.equal(response.status, 200); assert.deepEqual((await response.json()).edl, expected);
  snapshot = store.readEditor(id);
  const seq = snapshot.edl.sequences.find(s => s.id === "main")!;
  const trim = buildTimelineTrim(seq, "a", "end", -1, snapshot.edl.media);
  await tools.executeEditorTool(id, { tool: "project.edit", expectedRevision: snapshot.revision, operations: trim });
  assert.deepEqual(store.readEditor(id).edl, applyOperations(snapshot.edl, trim));
  const saved = store.readEditor(id);
  await assert.rejects(tools.executeEditorTool(id, { tool: "project.edit", expectedRevision: saved.revision, operations: [{ type: "sequence.patch", sequenceId: "main", title: "Should rollback" }, reorder("a", 0, 99)] }));
  assert.deepEqual(store.readEditor(id), saved);
});

test("free drag moves along Main and across layers without shifting neighboring items", () => {
  const initial = fixture();
  const moved = applyOperations(initial, buildTimelineMove(initial.sequences[0], "a", 2.04, 0));
  assert.deepEqual(starts(moved), { a: 2, b: 4, overlay: 1, overlay2: 9 });
  const crossed = applyOperations(moved, buildTimelineMove(moved.sequences[0], "overlay", 5, 0));
  assert.deepEqual(starts(crossed), { a: 2, b: 4, overlay: 5, overlay2: 9 });
  assert.equal(crossed.sequences[0].items.find(i => i.id === "overlay")!.layer, 0);
  assert.deepEqual(crossed.sequences[0].items.find(i => i.id === "overlay")!.clip, initial.sequences[0].items.find(i => i.id === "overlay")!.clip);
  const back = applyOperations(crossed, buildTimelineMove(crossed.sequences[0], "overlay", 3, 3));
  assert.deepEqual(starts(back), { a: 2, b: 4, overlay: 3, overlay2: 9 });
  assert.throws(() => applyOperations(back, buildTimelineMove(crossed.sequences[0], "overlay", 6, 1)), /changed/);
});
