import { test } from "node:test";
import { emptySequencePlan } from "../src/lib/plan/schema";
import assert from "node:assert/strict";
import { Clip, DEFAULT_ITEM_TRANSFORM, Edl, type Edit } from "../src/lib/edl";
import { snapAxis, snapSpan, snapTargets, snapTime } from "../src/lib/editor/snapping";
import { classifyFile, dropDuration, parseDrag } from "../src/lib/editor/dnd";
import { applyOperations } from "../src/lib/editor/operations";
import { invertOperations } from "../src/lib/editor/history";
import { buildTimelineGroupMove, buildTimelineSlip, timelineCollides } from "../src/lib/editor/timeline-interactions";
import { sequenceFrames } from "../src/lib/sequences";

const fixture = () => Edl.parse({ projectId: "test", source: null, media: [{ id: "source", name: "Source", file: "/tmp/source.mp4", width: 640, height: 360, fps: 10, durationSec: 20 }], clips: [], sequences: [{ id: "main", title: "Main", output: { width: 640, height: 360, fps: 10 }, items: [
  { id: "a", mediaId: "source", clip: Clip.parse({ title: "A", id: "a", start: 0, end: 4 }) },
  { id: "b", mediaId: "source", clip: Clip.parse({ title: "B", id: "b", start: 0, end: 3 }) },
  { id: "overlay", layer: 1, at: 9, mediaId: "source", clip: Clip.parse({ title: "O", id: "overlay", start: 0, end: 2 }) },
] }] });

test("snap targets cover the origin, the playhead and every other item edge", () => {
  const sequence = fixture().sequences[0];
  assert.deepEqual(snapTargets(sequence, { playheadSec: 5.5 }), [
    { at: 0, kind: "origin" }, { at: 4, kind: "edge" }, { at: 5.5, kind: "playhead" },
    { at: 7, kind: "edge" }, { at: 9, kind: "edge" }, { at: 11, kind: "edge" },
  ]);
  // The dragged item never snaps to itself, and a playhead sitting on an edge keeps its identity.
  const excluded = snapTargets(sequence, { excludeId: "overlay", playheadSec: 4 });
  assert.deepEqual(excluded, [{ at: 0, kind: "origin" }, { at: 4, kind: "playhead" }, { at: 7, kind: "edge" }]);
});

test("snapping prefers the playhead, respects tolerance and pulls a span by its nearest edge", () => {
  const targets = snapTargets(fixture().sequences[0], { playheadSec: 4.2 });
  assert.deepEqual(snapTime(4.1, targets, 0.3), { at: 4.2, guide: { at: 4.2, kind: "playhead" } });
  assert.deepEqual(snapTime(6.5, targets, 0.3), { at: 6.5, guide: null });
  assert.deepEqual(snapTime(4.1, targets, 0), { at: 4.1, guide: null });
  // The tail lands on 7, so the head moves back by the span's length rather than jumping forward.
  assert.deepEqual(snapSpan(4.9, 2.2, targets, 0.3), { at: 4.8, guide: { at: 7, kind: "edge" } });
  assert.deepEqual(snapSpan(8.9, 1, targets, 0.3), { at: 9, guide: { at: 9, kind: "edge" } });
  // A long span near the origin catches the origin by its head rather than being pushed
  // before it to satisfy its tail.
  assert.deepEqual(snapSpan(0.05, 30, snapTargets(fixture().sequences[0]), 0.3), { at: 0, guide: { at: 0, kind: "origin" } });
});

test("the drag vocabulary classifies desktop files and survives hostile payloads", () => {
  assert.equal(classifyFile("Shot 01.MOV"), "video");
  assert.equal(classifyFile("cover.jpeg"), "image");
  assert.equal(classifyFile("score.flac"), "audio");
  assert.equal(classifyFile("notes.txt"), null);
  assert.equal(parseDrag("not json"), null);
  assert.equal(parseDrag(JSON.stringify({ kind: "video" })), null);
  assert.deepEqual(parseDrag(JSON.stringify({ assetId: "x", kind: "nonsense" })), { assetId: "x", kind: "video" });
  assert.deepEqual(parseDrag(JSON.stringify({ file: "/a/b.mp3", kind: "audio" })), { file: "/a/b.mp3", kind: "audio" });
  assert.equal(dropDuration({ kind: "image", durationSec: null }), 3);
  assert.equal(dropDuration({ kind: "video", durationSec: 12 }), 12);
  assert.equal(dropDuration({ kind: "audio", durationSec: 0 }), 8);
});

const replaceable = () => Edl.parse({ projectId: "test", source: null, media: [
  { id: "long", name: "Long", file: "/tmp/long.mp4", width: 640, height: 360, fps: 10, durationSec: 20 },
  { id: "short", name: "Short", file: "/tmp/short.mp4", width: 320, height: 180, fps: 10, durationSec: 2 },
], clips: [], sequences: [{ id: "main", title: "Main", output: { width: 640, height: 360, fps: 10 }, items: [
  { id: "a", mediaId: "long", clip: Clip.parse({ title: "A", id: "a", start: 4, end: 10,
    words: [{ w: "hi", t: 0.5, d: 0.5 }], crop: [{ t: 0, x: 0, y: 0, w: 640, h: 360 }],
    edits: [{ type: "text", t: 1, d: 3, text: "Kept" }, { type: "text", t: 8, d: 1, text: "Dropped" }] }) },
  { id: "b", mediaId: "long", clip: Clip.parse({ title: "B", id: "b", start: 0, end: 3 }) },
] }] });

test("replacing an item's source keeps its slot, clamps to the new footage and drops stale analysis", () => {
  const initial = replaceable();
  const next = applyOperations(initial, [{ type: "item.source", sequenceId: "main", itemId: "a", mediaId: "short", title: "Short" }]);
  const item = next.sequences[0].items.find(i => i.id === "a")!;
  assert.equal(item.mediaId, "short");
  assert.deepEqual([item.clip.start, item.clip.end], [0, 2]);
  assert.equal(item.clip.title, "Short");
  // The transcript and crop describe footage that is gone; overlays the author wrote are kept and clipped.
  assert.deepEqual(item.clip.words, []);
  assert.deepEqual(item.clip.crop, []);
  assert.deepEqual(item.clip.edits.map(e => [e.t, e.d]), [[1, 1]]);
  // A longer replacement keeps the six seconds the item already occupied.
  const back = applyOperations(next, [{ type: "item.source", sequenceId: "main", itemId: "b", mediaId: "short" }]);
  assert.deepEqual([back.sequences[0].items.find(i => i.id === "b")!.clip.start, back.sequences[0].items.find(i => i.id === "b")!.clip.end], [0, 2]);
});

test("replacing a source refuses stale and missing media, and can empty an item onto the canvas", () => {
  const initial = replaceable();
  assert.throws(() => applyOperations(initial, [{ type: "item.source", sequenceId: "main", itemId: "a", mediaId: "short", before: { mediaId: "short" } }]), /changed/);
  assert.throws(() => applyOperations(initial, [{ type: "item.source", sequenceId: "main", itemId: "a", mediaId: "ghost" }]), /missing media/);
  const canvas = applyOperations(initial, [{ type: "item.source", sequenceId: "main", itemId: "a", mediaId: null, end: 30 }]);
  const item = canvas.sequences[0].items.find(i => i.id === "a")!;
  assert.equal(item.mediaId, null);
  assert.deepEqual([item.clip.start, item.clip.end], [0, 30]);
});

/**
 * An absent placement field and its default mean the same thing to every reader. Undo has to
 * write the default explicitly — an omitted field would leave the edit in place — so comparing
 * a round trip means comparing what the values resolve to, not whether they were spelled out.
 */
const DEFAULTS: Record<string, unknown> = { at: null, layer: 0, muted: false, hidden: false, volume: 1, transform: DEFAULT_ITEM_TRANSFORM };
const canonical = (edl: Edl) => JSON.parse(JSON.stringify(edl, (key, value) =>
  key in DEFAULTS && JSON.stringify(value) === JSON.stringify(DEFAULTS[key]) ? undefined : value));
const roundTrip = (edl: Edl, operations: Parameters<typeof invertOperations>[1], label: string) => {
  const after = applyOperations(edl, operations);
  const back = applyOperations(after, invertOperations(edl, operations));
  assert.deepEqual(canonical(back), canonical(applyOperations(edl, [])), label);
  return after;
};

test("every timeline operation can be undone through the same shared engine", () => {
  const edl = replaceable();
  roundTrip(edl, [{ type: "item.place", sequenceId: "main", itemId: "b", patch: { at: 7, layer: 2 } }], "free placement");
  roundTrip(edl, [{ type: "item.patch", sequenceId: "main", itemId: "a", patch: { start: 6 } }], "trim rebases words and edits");
  roundTrip(edl, [{ type: "item.split", sequenceId: "main", itemId: "a", at: 2, newItemId: "a2" }], "split");
  roundTrip(edl, [{ type: "item.reorder", sequenceId: "main", itemId: "b", layer: 0, index: 0 }], "reorder");
  roundTrip(edl, [{ type: "item.remove", sequenceId: "main", itemId: "a" }], "removal");
  roundTrip(edl, [{ type: "item.source", sequenceId: "main", itemId: "a", mediaId: "short" }], "source replacement");
  roundTrip(edl, [{ type: "item.edit.add", sequenceId: "main", itemId: "b", edit: { type: "text", t: 0, d: 1, text: "Hi", position: "top", x: null, y: null, style: "card", by: "" } }], "added overlay");
  roundTrip(edl, [{ type: "media.add", media: { id: "extra", name: "Extra", file: "/tmp/extra.mp4", width: 640, height: 360, fps: 10, durationSec: 5 } }], "media");
  roundTrip(edl, [{ type: "sequence.add", sequence: { id: "s2", title: "Second", output: { width: 640, height: 360, fps: 10 }, items: [], plan: emptySequencePlan() } }], "new sequence");
  roundTrip(edl, [{ type: "sequence.remove", sequenceId: "main" }], "deleted sequence");
  roundTrip(edl, [{ type: "sequence.patch", sequenceId: "main", title: "Renamed" }], "rename");
  // A whole gesture, inverted as one batch and replayed in reverse.
  roundTrip(edl, [
    { type: "item.add", sequenceId: "main", item: { id: "c", mediaId: "short", at: 12, layer: 3, clip: Clip.parse({ id: "c", title: "C", start: 0, end: 2 }) } },
    { type: "item.place", sequenceId: "main", itemId: "c", patch: { at: 5 } },
    { type: "item.patch", sequenceId: "main", itemId: "b", patch: { end: 1 } },
  ], "composite gesture");
});

test("undoing a promoted clip restores the generated clip it came from", () => {
  const edl = Edl.parse({ projectId: "test", source: { file: "/tmp/s.mp4", width: 640, height: 360, fps: 10, durationSec: 30 }, media: [], sequences: [],
    clips: [Clip.parse({ id: "clip1", title: "Clip", start: 1, end: 9, edits: [{ type: "text", t: 0, d: 2, text: "Hook" }] })] });
  roundTrip(edl, [{ type: "clip.promote", clipId: "clip1" }, { type: "item.place", sequenceId: "clip1", itemId: "clip1", patch: { volume: 0.5 } }], "promote then edit");
});

test("a group move places every picked item and freezes the rest where they resolved", () => {
  const initial = fixture();
  const ops = buildTimelineGroupMove(initial.sequences[0], [
    { itemId: "a", at: 12, layer: 2 },
    { itemId: "overlay", at: 3, layer: 2 },
  ]);
  const next = applyOperations(initial, ops);
  const placed = Object.fromEntries(sequenceFrames(next.sequences[0]).items.map(i => [i.item.id, i.from / 10]));
  // b followed a on the main track; lifting a away keeps b where it already was rather than
  // sliding it back to zero underneath the drag.
  assert.deepEqual(placed, { a: 12, overlay: 3, b: 4 });
  assert.throws(() => buildTimelineGroupMove(initial.sequences[0], [{ itemId: "a", at: 1, layer: 0 }, { itemId: "a", at: 2, layer: 0 }]), /once/);
  assert.throws(() => buildTimelineGroupMove(initial.sequences[0], [{ itemId: "ghost", at: 1, layer: 0 }]), /not found/);
  assert.deepEqual(buildTimelineGroupMove(initial.sequences[0], []), []);
});

test("canvas magnetism catches the frame's edges and centre, and lets go outside its reach", () => {
  // A 200-wide box inside a 1000-wide frame: leading 0, centre 400, trailing 800.
  assert.deepEqual(snapAxis(5, 200, 1000, 8), { delta: -5, guide: 0 });
  assert.deepEqual(snapAxis(396, 200, 1000, 8), { delta: 4, guide: 500 });
  assert.deepEqual(snapAxis(803, 200, 1000, 8), { delta: -3, guide: 1000 });
  assert.equal(snapAxis(300, 200, 1000, 8), null);
  assert.equal(snapAxis(5, 200, 1000, 0), null);
  assert.equal(snapAxis(Number.NaN, 200, 1000, 8), null);
  // A catch never claims the whole travel: a box with almost nowhere to go keeps every place it
  // could be. 996 of 1000 leaves 4 to move in, so the catches hold only the lines themselves.
  assert.deepEqual(snapAxis(2, 996, 1000, 8), { delta: 0, guide: 500 });
  assert.equal(snapAxis(3, 996, 1000, 8), null);
  // And a box the size of its frame, which has nowhere to go at all, is never pulled anywhere.
  assert.equal(snapAxis(6, 1000, 1000, 8), null);
  // The reach follows the frame, so the same gesture on a preview drawn small is the same nudge:
  // on a 120-wide frame it is a couple of pixels, not the eight a full-size preview can afford.
  assert.deepEqual(snapAxis(41, 40, 120, 8), { delta: -1, guide: 60 });
  assert.equal(snapAxis(44, 40, 120, 8), null);
});

test("a placement knows when it would hide a clip already on that track", () => {
  const sequence = fixture().sequences[0];
  // Main holds a at 0-4 and b at 4-7; the overlay track holds one clip at 9-11.
  assert.equal(timelineCollides(sequence, 0, 3.5, 1), true);
  assert.equal(timelineCollides(sequence, 0, 3.5, 1, ["a"]), true);
  assert.equal(timelineCollides(sequence, 0, 3.5, 1, ["a", "b"]), false);
  assert.equal(timelineCollides(sequence, 1, 3.5, 1), false);
  // Butting up against an edge is not a collision, and a zero-length span never collides.
  assert.equal(timelineCollides(sequence, 1, 7, 2), false);
  assert.equal(timelineCollides(sequence, 1, 8.5, 0.5), false);
  assert.equal(timelineCollides(sequence, 1, 9.5, 0), false);
  assert.equal(timelineCollides(sequence, 1, 10, 5), true);
});

test("slipping moves the footage under a clip without moving the clip or its overlays", () => {
  const initial = replaceable();
  const sequence = initial.sequences[0];
  const next = applyOperations(initial, buildTimelineSlip(sequence, "a", 2, initial.media));
  const item = next.sequences[0].items.find(i => i.id === "a")!;
  // The clip still occupies six seconds, two seconds later in the source.
  assert.deepEqual([item.clip.start, item.clip.end], [6, 12]);
  // The overlays stay where the author put them; the transcript follows the footage away.
  assert.deepEqual(item.clip.edits.map(e => [e.t, e.d]), [[1, 3], [8, 1]]);
  assert.deepEqual(item.clip.words, []);
  assert.deepEqual(sequenceFrames(next.sequences[0]).items.map(i => i.from), sequenceFrames(sequence).items.map(i => i.from));
  // It cannot slip past either end of its footage, and a canvas scene has nothing to slip.
  assert.deepEqual(applyOperations(initial, buildTimelineSlip(sequence, "a", -99, initial.media)).sequences[0].items[0].clip.start, 0);
  assert.deepEqual(buildTimelineSlip(sequence, "a", 0, initial.media), []);
  assert.throws(() => buildTimelineSlip(sequence, "ghost", 1, initial.media), /not found/);
});

test("undo restores a placement field that had never been set", () => {
  const edl = replaceable();
  // Hiding, muting and moving on the canvas all start from an absent field.
  for (const patch of [{ hidden: true }, { muted: true }, { volume: 0.2 }, { transform: { x: 12, y: 8, width: 30, height: 30, rotation: 0, opacity: 1 } }]) {
    const operations = [{ type: "item.place" as const, sequenceId: "main", itemId: "a", patch }];
    const after = applyOperations(edl, operations);
    const inverse = invertOperations(edl, operations);
    assert.ok(inverse.length && inverse[0].type === "item.place" && Object.keys(inverse[0].patch).length, `inverse of ${JSON.stringify(patch)} must carry values`);
    const back = applyOperations(after, inverse);
    const item = back.sequences[0].items.find(i => i.id === "a")!;
    assert.deepEqual(
      { hidden: item.hidden ?? false, muted: item.muted ?? false, volume: item.volume ?? 1, x: (item.transform ?? DEFAULT_ITEM_TRANSFORM).x },
      { hidden: false, muted: false, volume: 1, x: DEFAULT_ITEM_TRANSFORM.x },
      `undo of ${JSON.stringify(patch)}`,
    );
  }
});

test("inverting a batch of independent placements matches replaying it one at a time", () => {
  const edl = replaceable();
  const sequence = edl.sequences[0];
  const ops = buildTimelineGroupMove(sequence, [{ itemId: "a", at: 20, layer: 3 }, { itemId: "b", at: 2, layer: 1 }]);
  const after = applyOperations(edl, ops);
  // The fast path inverts every operation against the original state; the result must still
  // restore the project exactly, in the same order the slow path would have produced.
  assert.deepEqual(canonical(applyOperations(after, invertOperations(edl, ops))), canonical(applyOperations(edl, [])));
  const stepwise: typeof ops = [];
  let state = edl;
  for (const op of ops) { stepwise.unshift(...invertOperations(state, [op])); state = applyOperations(state, [op]); }
  assert.deepEqual(invertOperations(edl, ops), stepwise);
});

test("a whole editing session undoes back to exactly where it started", () => {
  const start = replaceable();
  const sequenceId = "main";
  // Every step is what one gesture in the editor emits, in the order a person would do them.
  const session: { what: string; ops: Parameters<typeof invertOperations>[1] }[] = [];
  let state = start;
  const step = (what: string, make: (edl: Edl) => Parameters<typeof invertOperations>[1]) => {
    const ops = make(state);
    session.push({ what, ops });
    state = applyOperations(state, ops);
  };

  step("drop a clip on a new track", () => [{ type: "item.add", sequenceId, item: {
    id: "dropped", mediaId: "short", at: 9, layer: 2, clip: Clip.parse({ id: "dropped", title: "Dropped", start: 0, end: 2 }) } }]);
  step("split the first clip at the playhead", () => [{ type: "item.split", sequenceId, itemId: "a", at: 2, newItemId: "a2" }]);
  step("slip the footage under it", edl => buildTimelineSlip(edl.sequences[0], "a2", 1, edl.media));
  step("drag two clips together", edl => buildTimelineGroupMove(edl.sequences[0], [
    { itemId: "a2", at: 30, layer: 4 }, { itemId: "dropped", at: 32, layer: 4 }]));
  step("replace what a clip plays", () => [{ type: "item.source", sequenceId, itemId: "b", mediaId: "short", title: "Swapped" }]);
  step("mute it", () => [{ type: "item.place", sequenceId, itemId: "b", patch: { muted: true } }]);
  step("remove a clip", () => [{ type: "item.remove", sequenceId, itemId: "a" }]);

  // The session did what it said: seven gestures, a new item, a split, a swap and a removal.
  const items = state.sequences[0].items;
  assert.equal(items.length, 3);
  assert.equal(items.find(i => i.id === "b")!.clip.title, "Swapped");
  assert.equal(items.find(i => i.id === "b")!.muted, true);
  assert.ok(!items.some(i => i.id === "a"));
  assert.deepEqual(sequenceFrames(state.sequences[0]).items.filter(i => (i.item.layer ?? 0) === 4).map(i => i.from / 10), [30, 32]);

  // Undoing every gesture in reverse walks the project back to exactly what it was.
  let undone = state;
  for (const { what, ops } of [...session].reverse()) {
    const base = applyOperations(start, session.slice(0, session.findIndex(entry => entry.ops === ops)).flatMap(entry => entry.ops));
    undone = applyOperations(undone, invertOperations(base, ops));
    assert.deepEqual(canonical(undone), canonical(base), `after undoing: ${what}`);
  }
  assert.deepEqual(canonical(undone), canonical(applyOperations(start, [])));
});

test("titles, pictures and captions move inside their frame in the frame's own units", async () => {
  const { moveOverlay, overlayLabel } = await import("../src/lib/editor/canvas");
  const clip = Clip.parse({ id: "c", title: "C", start: 0, end: 5, edits: [
    { type: "text", t: 0, d: 2, text: "Hook" },
    { type: "image", t: 0, d: 2, src: "pic", y: 0.3 },
    { type: "silence", t: 1, d: 0.5 },
  ] });
  const frame = { width: 1000, height: 2000 };
  // A 200x100 title measured at (400,300): its centre starts at (0.5,0.175) and follows the pointer.
  const moved = moveOverlay(clip, { kind: "edit", index: 0 }, { left: 400, top: 300, width: 200, height: 100 }, frame, 100, 400);
  assert.deepEqual(moved.guide, { x: null, y: null });
  const title = moved.clip.edits[0] as Extract<Edit, { type: "text" }>;
  assert.equal(title.x, 0.6); assert.equal(title.y, 0.375); assert.equal(title.position, "top");
  assert.equal(moved.clip.edits[1], clip.edits[1]);
  // Within reach of the frame's centre the box catches it and says where the guide goes.
  const caught = moveOverlay(clip, { kind: "edit", index: 1 }, { left: 100, top: 100, width: 300, height: 300 }, frame, 255, 0, 8);
  assert.deepEqual(caught.guide, { x: 500, y: null });
  assert.equal((caught.clip.edits[1] as Extract<Edit, { type: "image" }>).x, 0.5);
  // A picture dragged off the frame is kept inside 0..1, the range the renderer accepts.
  assert.equal((moveOverlay(clip, { kind: "edit", index: 1 }, { left: 100, top: 100, width: 300, height: 300 }, frame, 5000, -5000).clip.edits[1] as Extract<Edit, { type: "image" }>).y, 0);
  // Captions only travel vertically and write their top edge.
  const captions = moveOverlay(clip, { kind: "captions" }, { left: 70, top: 1440, width: 860, height: 120 }, frame, 300, -200, 8);
  assert.equal(captions.clip.captions.positionY, 0.62);
  assert.equal(captions.clip.edits, clip.edits);
  assert.deepEqual(captions.guide, { x: null, y: null });
  assert.throws(() => moveOverlay(clip, { kind: "edit", index: 2 }, { left: 0, top: 0, width: 10, height: 10 }, frame, 1, 1), /silence/);
  assert.throws(() => moveOverlay(clip, { kind: "edit", index: 9 }, { left: 0, top: 0, width: 10, height: 10 }, frame, 1, 1), /no longer/);
  assert.equal(overlayLabel(clip, { kind: "edit", index: 0 }), "title “Hook”");
  assert.equal(overlayLabel(clip, { kind: "edit", index: 1 }), "image");
  assert.equal(overlayLabel(clip, { kind: "captions" }), "captions");
  // The schema round-trips a free position and still defaults older titles to their preset.
  const parsed = Clip.parse({ ...clip, edits: [{ type: "text", t: 0, d: 1, text: "T", x: 0.25, y: 0.9 }, { type: "text", t: 0, d: 1, text: "U" }] });
  assert.deepEqual([parsed.edits[0], parsed.edits[1]].map(e => e.type === "text" ? [e.x, e.y] : null), [[0.25, 0.9], [null, null]]);
});
