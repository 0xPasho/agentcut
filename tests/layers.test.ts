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

/* ---- Keyframed layer transforms: a layer's placement over the item's own time ---- */

const keys = (itemId: string, keyframes: object[] | null, before?: object[] | null) =>
  ({ type: "item.keyframes", sequenceId: "main", itemId, keyframes, ...(before !== undefined ? { before } : {}) });
const itemOf = (edl: Edl, id: string) => edl.sequences[0].items.find(i => i.id === id)!;

test("a layer with no keyframes is the static transform it always was, and one keyframe holds", async () => {
  const { animatedAt } = await import("../src/lib/keyframes");
  const placed = applyOperations(fixture(), [place("one", { transform: { x: 10, opacity: 0.5 } })]);
  const still = itemOf(placed, "one");
  assert.deepEqual(animatedAt(still, 0), { ...DEFAULT_ITEM_TRANSFORM, x: 10, opacity: 0.5, volume: 1 });
  assert.deepEqual(animatedAt(still, 3.9), animatedAt(still, 0), "nothing moves without keyframes");
  const single = itemOf(applyOperations(placed, [keys("one", [{ t: 1, opacity: 0.2 }])] as never), "one");
  for (const t of [0, 1, 2, 3.9]) assert.equal(animatedAt(single, t).opacity, 0.2, `one keyframe holds the whole item, at ${t}s`);
  assert.equal(animatedAt(single, 2).x, 10, "a field no keyframe names keeps the static transform under it");
});

test("every named ease is a different way of getting there, and all of them arrive", async () => {
  const { animatedAt, EASES } = await import("../src/lib/keyframes");
  const at = (ease: string, t: number) =>
    animatedAt(itemOf(applyOperations(fixture(), [keys("one", [{ t: 0, x: 0, ease }, { t: 2, x: 100 }])] as never), "one"), t).x;
  assert.deepEqual(Object.keys(EASES).sort(), ["ease", "hold", "in", "linear", "out"], "the whole catalogue is implemented");
  for (const ease of Object.keys(EASES)) {
    assert.equal(at(ease, 0), 0, `${ease} starts where it is told`);
    assert.equal(at(ease, 2), 100, `${ease} arrives`);
    assert.equal(at(ease, 3), 100, `${ease} holds past the last keyframe`);
  }
  assert.equal(at("linear", 1), 50);
  assert.equal(at("linear", 0.5), 25);
  assert.equal(at("ease", 1), 50, "ease is symmetrical about the middle");
  assert.ok(at("ease", 0.5) < 25 && at("ease", 1.5) > 75, `ease is slow at both ends: ${at("ease", 0.5)}, ${at("ease", 1.5)}`);
  assert.equal(at("in", 1), 25, "in accelerates away from the first keyframe");
  assert.equal(at("out", 1), 75, "out decelerates into the second");
  assert.equal(at("hold", 1.99), 0, "hold does not travel at all");
  assert.equal(at("hold", 2), 100, "it steps on the frame the next keyframe starts");
});

test("keyframes are refused where they cannot mean anything, with the number in the message", () => {
  const edl = fixture();
  assert.throws(() => applyOperations(edl, [keys("one", [{ t: 2, x: 1 }, { t: 1, x: 2 }])] as never), /must run in order[\s\S]*1s is listed after 2s/);
  assert.throws(() => applyOperations(edl, [keys("one", [{ t: 1, x: 1 }, { t: 1, x: 2 }])] as never), /must run in order[\s\S]*1s is listed after 1s/);
  assert.throws(() => applyOperations(edl, [keys("one", [{ t: 0 }])] as never), /at 0s on “one” names nothing to animate/);
  // "one" is four seconds long at ten frames a second.
  applyOperations(edl, [keys("one", [{ t: 4, x: 1 }])] as never);
  assert.throws(() => applyOperations(edl, [keys("one", [{ t: 5, x: 1 }])] as never), /at 5s is past the end of “one”, which runs for 4\.00s/);
  assert.throws(() => applyOperations(edl, [keys("one", [{ t: -1, x: 1 }])] as never));
  assert.throws(() => applyOperations(edl, [keys("one", [{ t: 0, opacity: 2 }])] as never));
  // An empty list and no list are the same thing, and neither writes a field.
  const animated = applyOperations(edl, [keys("one", [{ t: 0, x: 1 }])] as never);
  for (const cleared of [null, []]) {
    const back = applyOperations(animated, [keys("one", cleared)] as never);
    assert.equal("keyframes" in itemOf(back, "one"), false, `${JSON.stringify(cleared)} leaves the layer holding still`);
  }
  assert.equal("keyframes" in itemOf(applyOperations(edl, [keys("one", [])] as never), "one"), false);
});

test("a fixed value for a field the keyframes animate is refused, but restoring one it already has is not", () => {
  const animated = applyOperations(fixture(), [keys("one", [{ t: 0, opacity: 1 }, { t: 2, opacity: 0 }]), keys("two", [{ t: 0, volume: 1 }, { t: 1, volume: 0.2 }])] as never);
  // A field the keyframes leave alone is still placed by hand, as it always was.
  assert.equal(itemOf(applyOperations(animated, [place("one", { transform: { x: 20 } })]), "one").transform!.x, 20);
  assert.throws(() => applyOperations(animated, [place("one", { transform: { opacity: 0.4 } })]), /“one” animates its opacity, so a fixed value would never be seen/);
  assert.throws(() => applyOperations(animated, [place("two", { volume: 0.5 })]), /“two” animates its volume/);
  // Writing back the value the static transform already holds changes nothing, so the
  // placement undo of a reorder — which restores every field of every item — still works.
  applyOperations(animated, [place("one", { transform: { ...DEFAULT_ITEM_TRANSFORM } })]);
  applyOperations(animated, [place("two", { volume: 1 })]);
});

test("a trim moves the footage under a move, not the move; what falls off the end is kept", async () => {
  const { animatedAt } = await import("../src/lib/keyframes");
  const animated = applyOperations(fixture(), [keys("one", [{ t: 0, opacity: 0 }, { t: 2, opacity: 1 }])] as never);
  const trim = (patch: object) => applyOperations(animated, [{ type: "item.patch", sequenceId: "main", itemId: "one", patch }]);
  const head = trim({ start: 1 });
  assert.deepEqual(itemOf(head, "one").keyframes, itemOf(animated, "one").keyframes,
    "t is the item's own time from its own first frame, so a trim from the head leaves it where it is");
  const tail = trim({ end: 1 });
  assert.equal(itemOf(tail, "one").keyframes!.length, 2, "a keyframe the trim put past the end is kept, not deleted");
  assert.ok(Math.abs(animatedAt(itemOf(tail, "one"), 0.9).opacity - 0.45) < 1e-9, "it is simply never reached");
  // Replacing the footage is about the footage: the layer keeps moving the way it did.
  const swapped = applyOperations(animated, [{ type: "item.source", sequenceId: "main", itemId: "one", mediaId: null }]);
  assert.deepEqual(itemOf(swapped, "one").keyframes, itemOf(animated, "one").keyframes);
});

test("splitting a moving layer changes no rendered value, and both halves carry their share", async () => {
  const { animatedAt } = await import("../src/lib/keyframes");
  const animated = applyOperations(fixture(), [keys("one", [{ t: 0, x: 0 }, { t: 4, x: 100 }])] as never);
  const split = applyOperations(animated, [{ type: "item.split", sequenceId: "main", itemId: "one", at: 1, newItemId: "tail" }]);
  const [first, second] = split.sequences[0].items;
  assert.equal(first.keyframes!.at(-1)!.t, 1);
  assert.equal(first.keyframes!.at(-1)!.x, 25, "the first half ends where the move had got to");
  assert.deepEqual([second.keyframes![0].t, second.keyframes![0].x], [0, 25], "and the second half starts there");
  assert.equal(second.keyframes!.at(-1)!.t, 3, "the rest of the move is rebased into the second half's own time");
  for (const t of [0, 0.5, 1, 2, 3, 4]) {
    const actual = t <= 1 ? animatedAt(first, t).x : animatedAt(second, t - 1).x;
    assert.ok(Math.abs(actual - 25 * t) < 1e-6, `the cut is invisible at ${t}s: ${actual} vs ${25 * t}`);
  }
  // A layer that was holding still does not acquire the field by being cut in two.
  const plain = applyOperations(fixture(), [{ type: "item.split", sequenceId: "main", itemId: "one", at: 1, newItemId: "tail" }]);
  for (const item of plain.sequences[0].items) assert.equal("keyframes" in item, false);
});

test("motion undoes through the same operations, refuses a stale form, and carries who placed it", async () => {
  const { invertOperations } = await import("../src/lib/editor/history");
  const { stampAuthor, describeAuthor } = await import("../src/lib/editor/authorship");
  const edl = fixture();
  const add = [keys("two", [{ t: 0, opacity: 0 }, { t: 1, opacity: 1 }])] as never;
  const added = applyOperations(edl, add);
  assert.deepEqual(applyOperations(added, invertOperations(edl, add)), edl, "undo puts the layer back to holding still");
  const change = [keys("two", [{ t: 0, opacity: 1 }, { t: 1, opacity: 0 }], itemOf(added, "two").keyframes)] as never;
  const changed = applyOperations(added, change);
  assert.deepEqual(applyOperations(changed, invertOperations(added, change)), added);
  assert.throws(() => applyOperations(changed, [keys("two", [{ t: 0, opacity: 0.5 }], null)] as never), /motion changed/);
  // Splitting halves a move, so undoing the split has to put the whole list back.
  const splitOp = [{ type: "item.split", sequenceId: "main", itemId: "two", at: 1, newItemId: "tail" }] as never;
  const split = applyOperations(added, splitOp);
  const back = applyOperations(split, invertOperations(added, splitOp));
  assert.deepEqual(itemOf(back, "two").keyframes, itemOf(added, "two").keyframes);
  assert.equal(back.sequences[0].items.length, 2);
  const stamped = stampAuthor({ tool: "project.edit", operations: [keys("two", [{ t: 0, opacity: 0 }, { t: 1, opacity: 1, by: "" }])] }, "agent:13") as { operations: [{ keyframes: [{ by: string }] }] };
  assert.equal(stamped.operations[0].keyframes[0].by, "agent:13");
  assert.equal(describeAuthor(stamped.operations[0].keyframes[0].by), "Placed by the agent (message 13)");
});

test("the panel's shortcuts are ordinary keyframe lists, Ken Burns included", async () => {
  const { kenBurns, pinPlacement, pinVolume, setKeyframe, retimeKeyframe, removeKeyframe } = await import("../src/lib/editor/motion");
  const { animatedAt, itemSeconds } = await import("../src/lib/keyframes");
  const still = itemOf(fixture(), "one");
  // A still gets a Ken Burns move out of exactly the fields every other layer animates.
  const move = kenBurns(still, itemSeconds(still, 10));
  const moved = applyOperations(fixture(), [keys("one", move)] as never);
  const opened = animatedAt(itemOf(moved, "one"), 0), closed = animatedAt(itemOf(moved, "one"), 4);
  assert.deepEqual([opened.x, opened.y, opened.width, opened.height], [0, 0, 100, 100], "it starts exactly where the layer already was");
  assert.ok(closed.width > opened.width && closed.height > opened.height, `and ends larger: ${closed.width}`);
  assert.ok(closed.x < opened.x, `drifting as it grows rather than only zooming: ${closed.x}`);
  const midway = animatedAt(itemOf(moved, "one"), 2);
  assert.ok(midway.width > opened.width && midway.width < closed.width, `and it is part-way there in the middle: ${midway.width}`);
  // Pinning the placement is one keyframe holding what the layer is; a drag then moves it.
  const pinned = { ...still, keyframes: pinPlacement(still, 0) };
  assert.equal(pinned.keyframes.length, 1);
  const dragged = setKeyframe(pinned, 2, { x: 40, y: 10 });
  assert.deepEqual(dragged.map(k => [k.t, k.x]), [[0, 0], [2, 40]]);
  assert.equal(animatedAt({ ...pinned, keyframes: dragged }, 1).x, 20, "the drag made a move, not a new position for the whole shot");
  // A field arriving for the first time is anchored on the keyframes already there.
  const ducked = setKeyframe({ ...pinned, keyframes: dragged }, 1, { volume: 0.2 });
  assert.equal(ducked[0].volume, 1, "the moments already pinned keep the volume they had");
  assert.equal(ducked.find(k => k.t === 1)!.volume, 0.2);
  assert.equal(pinVolume(still, 0)[0].volume, 1);
  // Retiming keeps the list in order; two keyframes never land on the same moment.
  assert.deepEqual(retimeKeyframe(dragged, 1, 0).map(k => k.t), [0, 0.008]);
  assert.deepEqual(retimeKeyframe(dragged, 0, 3).map(k => k.t), [2, 3]);
  assert.deepEqual(removeKeyframe(dragged, 0).map(k => k.t), [2]);
});

test("a saved timeline that holds still stays free of keyframes, and an old EDL still parses", () => {
  const legacy = Edl.parse({ projectId: "old", source: null, clips: [], sequences: [{ id: "s", title: "Old", output: { width: 640, height: 360, fps: 10 },
    items: [{ id: "a", mediaId: null, clip: { id: "a", title: "A", start: 0, end: 2 } }] }] });
  assert.equal(legacy.sequences[0].items[0].keyframes, undefined);
  assert.equal(JSON.stringify(legacy).includes("keyframes"), false, "reading an old EDL does not write a migration into it");
  const edited = applyOperations(legacy, [{ type: "item.patch", sequenceId: "s", itemId: "a", patch: { title: "A again" } }]);
  assert.equal(JSON.stringify(edited).includes("keyframes"), false);
});
