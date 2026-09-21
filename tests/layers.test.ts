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

/* ---- Transitions: the joint between two shots on one track ---- */

const dissolve = (itemId: string, durationSec = 0.5, extra: object = {}) =>
  ({ type: "item.transition", sequenceId: "main", itemId, transition: { kind: "dissolve", durationSec, ...extra } });
/** Three shots on Main: 4s, 2s, 3s at 10 fps. */
const three = () => {
  const edl = fixture();
  edl.sequences[0].items.push({ id: "three", mediaId: null, clip: clip("three", 3) });
  return edl;
};

test("a transition overlaps the two shots it joins, shortens the programme and puts it back", () => {
  const edl = fixture();
  assert.equal(sequenceFrames(edl.sequences[0]).duration, 60);
  const dissolved = applyOperations(edl, [dissolve("two", 0.5)]);
  const frames = sequenceFrames(dissolved.sequences[0]);
  assert.deepEqual(frames.items.map(entry => [entry.from, entry.duration]), [[0, 40], [35, 20]]);
  assert.equal(frames.items[1].transition!.frames, 5, "the incoming shot blends over its first five frames");
  assert.equal(frames.items[0].outFrames, 5, "the outgoing shot knows its own half of the joint");
  assert.equal(frames.duration, 55, "the overlap comes out of the programme, not out of the footage");
  // Neither shot was trimmed, so removing the transition restores the timing exactly.
  for (const shot of dissolved.sequences[0].items) assert.deepEqual([shot.clip.start, shot.clip.end], [0, shot.id === "one" ? 4 : 2]);
  const removed = applyOperations(dissolved, [{ type: "item.transition", sequenceId: "main", itemId: "two", transition: null }]);
  assert.deepEqual(removed, edl);
});

test("a transition is refused where it cannot mean anything, and says why", () => {
  const edl = three();
  assert.throws(() => applyOperations(edl, [dissolve("one")]), /first shot on its track/);
  // "two" is 2s long, so the joint can give 1.9s: one frame of each shot must survive.
  applyOperations(edl, [dissolve("two", 1.9)]);
  assert.throws(() => applyOperations(edl, [dissolve("two", 2)]), /longest this joint can take is 1\.90s/);
  assert.throws(() => applyOperations(edl, [dissolve("two", 0.04)]), /at least one frame/);
  assert.throws(() => applyOperations(edl, [{ ...dissolve("two"), transition: { kind: "dissolve", durationSec: 0 } }]));
  // Two transitions on one shot may not overlap each other: "two" has 20 frames to give.
  const both = applyOperations(edl, [dissolve("three", 1.5)]);
  assert.throws(() => applyOperations(both, [dissolve("two", 0.5)]), /longest this joint can take is 0\.40s/);
  applyOperations(both, [dissolve("two", 0.4)]);
  // A shot on another track has nothing before it there, whatever sits below it.
  const overlay = applyOperations(edl, [place("three", { layer: 1, at: 1 })]);
  assert.throws(() => applyOperations(overlay, [dissolve("three")]), /first shot on its track/);
  // A shot pinned to a fixed time cannot be pulled back, so it blends over what it has.
  const pinned = applyOperations(edl, [place("two", { at: 4.5 })]);
  assert.throws(() => applyOperations(pinned, [dissolve("two", 0.5)]), /overlaps “one” by 0\.00s/);
  const touching = applyOperations(edl, [place("two", { at: 3.7 })]);
  applyOperations(touching, [dissolve("two", 0.3)]);
  assert.throws(() => applyOperations(touching, [dissolve("two", 0.5)]), /overlaps “one” by 0\.30s/);
});

test("a transition never makes an unrelated edit fail: what a joint loses is clamped, not refused", () => {
  const edl = applyOperations(three(), [dissolve("two", 1.5)]);
  assert.equal(sequenceFrames(edl.sequences[0]).items[1].transition!.frames, 15);
  // Removing the shot before it leaves nothing to blend from. The edit still applies.
  const orphan = applyOperations(edl, [{ type: "item.remove", sequenceId: "main", itemId: "one" }]);
  assert.equal(orphan.sequences[0].items[0].transition!.durationSec, 1.5, "the author's transition is kept");
  assert.equal(sequenceFrames(orphan.sequences[0]).items[0].transition, null, "but it resolves to nothing");
  assert.equal(sequenceFrames(orphan.sequences[0]).duration, 50);
  // Shortening the incoming shot under a transition clamps it to what is left.
  const short = applyOperations(edl, [{ type: "item.patch", sequenceId: "main", itemId: "two", patch: { end: 1 } }]);
  assert.equal(sequenceFrames(short.sequences[0]).items[1].transition!.frames, 9);
});

test("splitting a shot leaves the opening blend on the half that still has the joint", () => {
  const edl = applyOperations(fixture(), [dissolve("two", 0.5)]);
  const split = applyOperations(edl, [{ type: "item.split", sequenceId: "main", itemId: "two", at: 1, newItemId: "tail" }]);
  assert.equal(split.sequences[0].items[1].transition!.kind, "dissolve");
  assert.equal(split.sequences[0].items[2].transition, undefined, "the second half meets the first on a hard cut");
  assert.equal(sequenceFrames(split.sequences[0]).duration, 55);
});

test("transitions undo through the same operations, and carry who placed them", async () => {
  const { invertOperations } = await import("../src/lib/editor/history");
  const { stampAuthor } = await import("../src/lib/editor/authorship");
  const { describeAuthor } = await import("../src/lib/editor/authorship");
  const edl = fixture();
  const add = [dissolve("two", 0.5)] as never;
  const added = applyOperations(edl, add);
  assert.deepEqual(applyOperations(added, invertOperations(edl, add)), edl);
  const change = [{ ...dissolve("two", 0.8, { kind: "dip", color: "#ffffff" }), before: added.sequences[0].items[1].transition }] as never;
  const changed = applyOperations(added, change);
  assert.equal(changed.sequences[0].items[1].transition!.kind, "dip");
  assert.deepEqual(applyOperations(changed, invertOperations(added, change)), added);
  assert.throws(() => applyOperations(changed, [{ ...dissolve("two"), before: null }] as never), /transition changed/);
  const stamped = stampAuthor({ tool: "project.edit", operations: [dissolve("two")] }, "agent:42") as { operations: [{ transition: { by: string } }] };
  assert.equal(stamped.operations[0].transition.by, "agent:42");
  assert.equal(describeAuthor(stamped.operations[0].transition.by), "Placed by the agent (message 42)");
});

test("an equal-power crossfade holds its loudness through the joint", async () => {
  const { crossfadeGain } = await import("../src/lib/sequences");
  const fade = { inFrames: 10, outFrames: 0, durationFrames: 40 };
  const out = { inFrames: 0, outFrames: 10, durationFrames: 40 };
  for (const frame of [0, 2, 5, 8, 10]) {
    const rising = crossfadeGain(frame, fade), falling = crossfadeGain(30 + frame, out);
    assert.ok(Math.abs(rising ** 2 + falling ** 2 - 1) < 1e-9, `${rising} and ${falling} at frame ${frame}`);
  }
  assert.equal(crossfadeGain(0, fade), 0);
  assert.equal(crossfadeGain(10, fade), 1);
  assert.equal(crossfadeGain(25, fade), 1, "a shot with no ramp under it is untouched");
});
