import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTimeMap, clipFrames, spanFrames } from "../src/lib/timeline";
import { tightenBoundaries } from "../src/lib/pipeline/boundaries";
import { Clip } from "../src/lib/edl";
import type { Word } from "../src/lib/transcript";

const clip = (start: number, end: number, edits: Array<{ type: "silence"; t: number; d: number }>) =>
  Clip.parse({ id: "c", title: "c", start, end, edits });

test("kept spans tile the output without a gap or a frame nobody owns", () => {
  // 1.44s + 1.44s: each span rounds down on its own, the pair rounds up. Rounding
  // them separately leaves frame 28 belonging to no span, which renders black.
  const map = buildTimeMap(clip(0, 3, [{ type: "silence", t: 1.44, d: 0.12 }]));
  const frames = spanFrames(map, 10);
  assert.equal(frames.length, 2);
  assert.equal(frames[0].from, 0);
  assert.equal(frames[0].from + frames[0].durationInFrames, frames[1].from, "second span starts where the first ends");
  assert.equal(clipFrames(map, 10), 29);
  assert.equal(frames[1].from + frames[1].durationInFrames, clipFrames(map, 10), "the last span ends on the clip's last frame");
});

test("every silence cut leaves the timeline contiguous, at any rate", () => {
  for (const fps of [24, 25, 29.97, 30, 60]) {
    for (let i = 0; i < 40; i++) {
      const cuts = [
        { type: "silence" as const, t: 0.37 + i * 0.011, d: 0.41 },
        { type: "silence" as const, t: 3.13 + i * 0.017, d: 0.62 },
        { type: "silence" as const, t: 7.01 + i * 0.023, d: 0.5 },
      ];
      const map = buildTimeMap(clip(0, 12, cuts));
      const frames = spanFrames(map, fps);
      for (let n = 1; n < frames.length; n++) {
        assert.equal(frames[n].from, frames[n - 1].from + frames[n - 1].durationInFrames, `gap at ${fps}fps, case ${i}`);
      }
      assert.equal(frames.at(-1)!.from + frames.at(-1)!.durationInFrames, clipFrames(map, fps));
      assert.ok(frames.every((f) => f.durationInFrames >= 1));
    }
  }
});

const words = (spec: Array<[number, number, string]>): Word[] => spec.map(([t, d, w]) => ({ t, d, w }));

test("a clip does not open on dead air the transcript never showed", () => {
  const speech = words([[32, 0.4, "Esto"], [32.5, 0.5, "funciona."]]);
  const [start, end] = tightenBoundaries(speech, 20, 40, { duration: 600, fps: 30 });
  assert.ok(Math.abs(start - 31.75) < 0.01, `twelve seconds of room tone become a quarter second: ${start}`);
  assert.ok(end < 33.5, `and the tail stops just after the last word: ${end}`);
});

test("a reaction in the dead air is why the clip starts there", () => {
  const speech = words([[32, 0.4, "Esto"], [32.5, 0.5, "funciona."]]);
  const [start] = tightenBoundaries(speech, 20, 40, { duration: 600, fps: 30, peaks: [24.5, 25.1] });
  assert.ok(Math.abs(start - 24.15) < 0.01, `laughter at 24.5 is the opening, not silence: ${start}`);
});

test("the last word is never cut off, and the next one never bleeds in", () => {
  const speech = words([[10, 0.5, "palabra"], [10.9, 0.4, "siguiente"]]);
  const [, end] = tightenBoundaries(speech, 10, 10.52, { duration: 600, fps: 30 });
  assert.ok(end >= 10.5, `the word it ends on plays out: ${end}`);
  assert.ok(end <= 10.85, `without starting the word after it: ${end}`);
});

test("a boundary inside a word takes the whole word", () => {
  const speech = words([[10, 0.6, "entonces"], [11, 0.5, "vamos"]]);
  const [start, end] = tightenBoundaries(speech, 10.3, 11.2, { duration: 600, fps: 30 });
  assert.equal(start, 10);
  assert.ok(end >= 11.5, `${end}`);
});

test("footage with nothing spoken in it keeps the boundaries it was given", () => {
  const [start, end] = tightenBoundaries(words([[500, 0.4, "luego"]]), 100, 130, { duration: 600, fps: 30 });
  assert.equal(start, 100);
  assert.equal(end, 130);
});

test("a clip never ends on the source's last frame", () => {
  const [, end] = tightenBoundaries([], 10, 99, { duration: 20, fps: 25 });
  assert.equal(end, 19.96);
});

test("trailing laughter survives, plain dead air does not", () => {
  const speech = words([[10, 0.5, "remate."]]);
  const quiet = tightenBoundaries(speech, 9.8, 30, { duration: 600, fps: 30 })[1];
  assert.ok(quiet < 11, `twenty seconds of silence after the line go: ${quiet}`);
  const laughed = tightenBoundaries(speech, 9.8, 30, { duration: 600, fps: 30, peaks: [11.2, 12.4] })[1];
  assert.ok(laughed >= 13 && laughed <= 13.1, `the laugh stays: ${laughed}`);
});

const rhythm = { enabled: true, maxGapSec: 1.5, minWords: 2, keepSec: 0.08 };

test("a phrase said twice in a row loses its false start, not its second run", async () => {
  const { redundancyCuts } = await import("../src/lib/templates/script");
  const said = words([
    [0, 0.2, "Y"], [0.25, 0.4, "entonces"], [0.7, 0.2, "yo"],
    [1.0, 0.2, "y"], [1.25, 0.4, "entonces"], [1.7, 0.2, "yo"],
    [1.95, 0.3, "creo"], [2.3, 0.2, "que"],
  ]);
  const cuts = redundancyCuts(said, rhythm, 3);
  assert.equal(cuts.length, 1);
  assert.equal(cuts[0].t, 0);
  assert.ok(Math.abs(cuts[0].t + cuts[0].d - 0.92) < 0.001, `the cut ends just before the second run: ${cuts[0].d}`);
});

test("a repeated word on its own is emphasis, and a repetition minutes later is deliberate", async () => {
  const { redundancyCuts } = await import("../src/lib/templates/script");
  const emphasis = words([[0, 0.2, "muy"], [0.3, 0.2, "muy"], [0.6, 0.4, "bueno"]]);
  assert.deepEqual(redundancyCuts(emphasis, rhythm, 2), []);
  const later = words([
    [0, 0.2, "esto"], [0.25, 0.3, "funciona"],
    [4.0, 0.2, "esto"], [4.25, 0.3, "funciona"],
  ]);
  assert.deepEqual(redundancyCuts(later, rhythm, 6), []);
});

test("punctuation and capitals do not hide a repetition", async () => {
  const { redundancyCuts } = await import("../src/lib/templates/script");
  const said = words([
    [0, 0.3, "Entonces,"], [0.4, 0.3, "esto"],
    [0.8, 0.3, "entonces"], [1.2, 0.3, "esto"], [1.6, 0.4, "pasa."],
  ]);
  assert.equal(redundancyCuts(said, rhythm, 3).length, 1);
});

test("a disabled rhythm cuts nothing", async () => {
  const { redundancyCuts } = await import("../src/lib/templates/script");
  const said = words([[0, 0.2, "y"], [0.25, 0.2, "esto"], [0.5, 0.2, "y"], [0.75, 0.2, "esto"]]);
  assert.deepEqual(redundancyCuts(said, { ...rhythm, enabled: false }, 2), []);
});
