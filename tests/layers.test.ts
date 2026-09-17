import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Edl, Clip, DEFAULT_ITEM_TRANSFORM } from "../src/lib/edl";
import { applyOperations, type EditorSnapshot } from "../src/lib/editor/operations";
import { sequenceFrames } from "../src/lib/sequences";
import { promoteClipToSequence } from "../src/lib/editor/editable-timeline";

const clip = (id: string, duration = 4) => Clip.parse({ id, title: id, start: 0, end: duration });
const fixture = () => Edl.parse({ projectId: "layers", source: null, clips: [], sequences: [{ id: "main", title: "Main", output: { width: 640, height: 360, fps: 10 }, items: [{ id: "one", mediaId: null, clip: clip("one") }, { id: "two", mediaId: null, clip: clip("two", 2) }] }] });
const place = (itemId: string, patch: object, before?: object) => ({ type: "item.place", sequenceId: "main", itemId, patch, ...(before ? { before } : {}) });

test("legacy ordering, overlapping layers, gaps and hidden duration share frame allocation", () => {
  const edl = fixture();
  assert.deepEqual(sequenceFrames(edl.sequences[0]).items.map(i => i.from), [0, 40]);
  const overlap = applyOperations(edl, [place("two", { layer: 1, at: 1, hidden: true })]);
  assert.deepEqual(sequenceFrames(overlap.sequences[0]).items.map(i => i.from), [0, 10]);
  assert.equal(sequenceFrames(overlap.sequences[0]).duration, 40);
  const gap = applyOperations(overlap, [place("two", { at: 8 })]);
  assert.equal(sequenceFrames(gap.sequences[0]).duration, 100);
  const auto = applyOperations(gap, [place("two", { at: null })]);
  assert.equal(sequenceFrames(auto.sequences[0]).items[1].from, 0);
  assert.equal(auto.sequences[0].items[1].hidden, true);
});

test("partial placement preserves transforms and checks only supplied stale fields", () => {
  const first = applyOperations(fixture(), [place("one", { transform: { x: 30, width: 40 }, volume: 0.5 })]);
  const next = applyOperations(first, [place("one", { transform: { opacity: 0.6 }, muted: true }, { transform: { x: 30 } })]);
  assert.deepEqual(next.sequences[0].items[0].transform, { ...DEFAULT_ITEM_TRANSFORM, x: 30, width: 40, opacity: 0.6 });
  assert.equal(next.sequences[0].items[0].volume, 0.5);
  assert.throws(() => applyOperations(next, [place("one", { layer: 2 }, { transform: { x: 0 } })]), /changed/);
  for (const patch of [{ at: -1 }, { layer: 0.5 }, { volume: 3 }, { transform: { width: 0 } }, { transform: { opacity: 2 } }]) {
    assert.throws(() => applyOperations(next, [place("one", patch)]));
  }
  assert.equal(first.sequences[0].items[0].muted, undefined);
});

test("splitting an explicitly positioned layer uses output time after silence cuts", () => {
  const edl = fixture();
  edl.sequences[0].items[0].clip = Clip.parse({ ...clip("one", 8), edits: [{ type: "silence", t: 1, d: 2 }] });
  const placed = applyOperations(edl, [place("one", { at: 3, layer: 2, transform: { x: 20 } })]);
  const split = applyOperations(placed, [{ type: "item.split", sequenceId: "main", itemId: "one", at: 4, newItemId: "right" }]);
  assert.deepEqual(sequenceFrames(split.sequences[0]).items.slice(0, 2).map(i => [i.from, i.duration]), [[30, 20], [50, 40]]);
  assert.equal(split.sequences[0].items[1].at, 5);
  assert.deepEqual(split.sequences[0].items[1].transform, placed.sequences[0].items[0].transform);
  const automatic = applyOperations(edl, [{ type: "item.split", sequenceId: "main", itemId: "one", at: 4, newItemId: "right" }]);
  assert.equal(automatic.sequences[0].items[1].at, undefined);
});

const generated = () => Edl.parse({ projectId: "layers", source: { file: "/tmp/source.mp4", width: 640, height: 360, fps: 30, durationSec: 30 }, clips: [{ ...clip("generated"), edits: [{ type: "text", t: 0, d: 3, text: "Keep me" }], words: [{ w: "hello", t: 0, d: 1 }] }] });
test("promotion preserves target identity and every edit, reuses media and is idempotent", () => {
  const edl = generated();
  edl.media.push({ ...edl.source!, file: "/tmp/other.mp4", id: "original-source", name: "Other" });
  const promoted = promoteClipToSequence(edl, "generated");
  assert.equal(promoted.clips.length, 0);
  assert.equal(promoted.sequences[0].id, "generated");
  assert.deepEqual(promoted.sequences[0].items[0].clip, edl.clips[0]);
  assert.equal(promoted.sequences[0].items[0].mediaId, "original-source-2");
  assert.deepEqual(applyOperations(edl, [{ type: "clip.promote", clipId: "generated" }]), promoted);
  assert.deepEqual(promoteClipToSequence(promoted, "generated"), promoted);
  edl.media.push({ ...edl.source!, id: "reused", name: "Existing" });
  assert.equal(promoteClipToSequence(edl, "generated").sequences[0].items[0].mediaId, "reused");
});

let workspace: string;
let store: typeof import("../src/lib/editor/store");
let database: typeof import("../src/lib/db");
let tools: typeof import("../src/lib/editor/tools");
before(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agentcut-layers-"));
  process.env.AGENTCUT_WORKSPACE = workspace;
  database = await import("../src/lib/db"); store = await import("../src/lib/editor/store"); tools = await import("../src/lib/editor/tools");
});
after(async () => { database.db.close(); await fs.rm(workspace, { recursive: true, force: true }); });

test("HTTP promotion and agent placement share state, both handoffs, and atomic validation", async () => {
  const edl = generated();
  database.q.insertProject({ id: edl.projectId, name: "Layers", source_path: edl.source!.file, created_at: Date.now() });
  const initial = store.publishClips(edl.projectId, edl);
  const { PATCH } = await import("../src/app/api/projects/[id]/route");
  const { NextRequest } = await import("next/server");
  const ops = [{ type: "clip.promote", clipId: "generated" }];
  const response = await PATCH(new NextRequest("http://localhost/api/projects/layers", { method: "PATCH", body: JSON.stringify({ expectedRevision: initial.revision, operations: ops }) }), { params: Promise.resolve({ id: "layers" }) });
  assert.equal(response.status, 200);
  const ui = await response.json() as EditorSnapshot;
  assert.deepEqual(ui.edl, applyOperations(initial.edl, ops));
  const placement = { type: "item.place", sequenceId: "generated", itemId: "generated", patch: { at: 1, layer: 2, transform: { width: 30 }, volume: 0.4 } };
  const agent = await tools.executeEditorTool("layers", { tool: "project.edit", expectedRevision: ui.revision, operations: [placement] }) as EditorSnapshot;
  assert.deepEqual(agent.edl, applyOperations(ui.edl, [placement]));
  const human = store.editProject("layers", { expectedRevision: agent.revision, operations: [{ ...placement, patch: { muted: true }, before: { volume: 0.4 } }] });
  assert.equal(human.edl.sequences[0].items[0].transform!.width, 30);
  assert.equal(human.edl.sequences[0].items[0].muted, true);
  assert.throws(() => store.editProject("layers", { expectedRevision: human.revision, operations: [{ ...placement, patch: { at: 5 } }, { type: "item.add", sequenceId: "generated", item: { id: "invalid", mediaId: "absent", clip: clip("invalid") } }] }), /missing media/);
  assert.deepEqual(store.readEditor("layers"), human);
});
