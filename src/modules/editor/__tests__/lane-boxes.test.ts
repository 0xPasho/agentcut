import { test } from "node:test";
import assert from "node:assert/strict";
import { laneBoxes, MIN_CLIP_PX } from "../lib/sequence-timeline";

/**
 * Drawing one track. A short clip has to be wide enough to grab, and no clip may be drawn
 * over the one after it — the two rules met at a zoomed-out timeline of fast cuts, where the
 * minimum width used to swallow the next clip's start.
 */
const boxes = (entries: [string, number, number][], pxPerFrame = 1) =>
  laneBoxes(entries.map(([id, from, duration]) => ({ id, from, duration })), pxPerFrame);

test("a short clip is drawn wide enough to grab when there is empty space in front of it", () => {
  const drawn = boxes([["a", 0, 2]]);
  assert.equal(drawn.get("a")?.width, MIN_CLIP_PX);
});

test("a clip never reaches past the start of the clip that follows it", () => {
  const drawn = boxes([["a", 0, 5], ["b", 5, 5], ["c", 10, 60]]);
  assert.equal(drawn.get("a")?.width, 5);
  assert.equal(drawn.get("b")?.width, 5);
  assert.equal(drawn.get("a")!.left + drawn.get("a")!.width, drawn.get("b")!.left);
  assert.equal(drawn.get("c")?.width, 60);
});

test("a clip borrows only the gap in front of it, not the neighbour", () => {
  const drawn = boxes([["a", 0, 2], ["b", 20, 2], ["c", 100, 2]]);
  assert.equal(drawn.get("a")?.width, 20);
  assert.equal(drawn.get("b")?.width, MIN_CLIP_PX);
});

test("clips that overlap in the sequence keep their real width, so a stack still reads as one", () => {
  const drawn = boxes([["a", 0, 100], ["b", 50, 100]]);
  assert.equal(drawn.get("a")?.width, 100);
  assert.equal(drawn.get("b")?.width, 100);
});

test("order on the track comes from the times, not the order the items arrive in", () => {
  const drawn = boxes([["b", 50, 4], ["a", 0, 4]]);
  assert.equal(drawn.get("a")?.room, 50);
  assert.equal(drawn.get("b")?.room, Infinity);
});

test("the scale carries through", () => {
  const drawn = boxes([["a", 0, 30], ["b", 30, 30]], .5);
  assert.equal(drawn.get("a")?.width, 15);
  assert.equal(drawn.get("b")?.left, 15);
});
