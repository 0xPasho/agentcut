import { test } from "node:test";
import assert from "node:assert/strict";
import { reviewQueue, reviewTally, swipeVerdict } from "../lib/review";
import type { ProjectVideo } from "../lib/overview";
import { SWIPE } from "../data";

const video = (id: string, status: ProjectVideo["status"]): ProjectVideo => ({
  id, title: id, kind: "sequence", durationSec: 30, shots: 1, status, score: null, tags: [], summary: "",
  error: null, sourceStart: null, sequence: null, clip: null,
});

test("a review walks the undecided videos in screen order, or all of them once everything has a verdict", () => {
  const list = [video("a", "approved"), video("b", "pending"), video("c", "rejected"), video("d", "edited"), video("e", "rendered")];
  assert.deepEqual(reviewQueue(list), ["b", "d"]);
  const decided = [video("a", "approved"), video("c", "rejected")];
  assert.deepEqual(reviewQueue(decided), ["a", "c"]);
});

test("a card is decided by distance or by a flick, and a flick against the drag decides nothing", () => {
  assert.equal(swipeVerdict(40, 0, 600), null);
  assert.equal(swipeVerdict(600 * SWIPE.distance, 0, 600), "approved");
  assert.equal(swipeVerdict(-SWIPE.minDistance, 0, 200), "rejected", "a narrow card still needs the floor, and the floor is enough");
  assert.equal(swipeVerdict(-30, -(SWIPE.velocity + 0.1), 600), "rejected");
  assert.equal(swipeVerdict(30, -(SWIPE.velocity + 0.1), 600), null);
});

test("skips do not count as verdicts", () => {
  assert.deepEqual(reviewTally([
    { id: "a", previous: "pending", verdict: "approved" },
    { id: "b", previous: null, verdict: null },
    { id: "c", previous: "edited", verdict: "rejected" },
  ]), { approved: 1, rejected: 1 });
});
