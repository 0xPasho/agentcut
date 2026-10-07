import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTimeMap, clipFrames, spanFrames } from "../../editor/lib/timeline";
import { tightenBoundaries } from "../lib/boundaries";
import { Clip } from "../../editor/types";
import type { Word } from "../../transcription/lib/transcript";

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

test("a clip does not open on the end of another answer's sentence", () => {
  // Measured: "…está difícil | sin el certificado." then the question this clip is about.
  const words = [
    { t: 10, d: 0.13, w: "difícil" }, { t: 10.13, d: 0.23, w: "sin" }, { t: 10.36, d: 0.17, w: "el" },
    { t: 10.53, d: 8.29, w: "certificado." }, { t: 20.4, d: 0.13, w: "¿Qué" }, { t: 20.53, d: 0.1, w: "es" },
    { t: 20.7, d: 0.3, w: "lo" }, { t: 21.1, d: 0.4, w: "primero?" }, { t: 21.6, d: 0.4, w: "Bajo" }, { t: 22.1, d: 0.5, w: "referencias." },
  ];
  const [start] = tightenBoundaries(words, 10.4, 23, { duration: 100 });
  assert.ok(start > 18.82 && start <= 20.4, `opens on the question: ${start}`);
  // A clip that starts on a sentence of its own, or a transcript without punctuation, stands.
  assert.equal(tightenBoundaries(words, 20.3, 23, { duration: 100 })[0], 20.3);
  const bare = words.map((w) => ({ ...w, w: w.w.replace(/[.?¿]/g, "") }));
  assert.ok(tightenBoundaries(bare, 10.4, 23, { duration: 100 })[0] < 10.4);
});

test("a clip that stops a few words short of its full stop runs on to it", () => {
  // Measured: "…es la referencia para que te | construya cosas buenas." — the clip ended on "te".
  const words = "porque de ahí es la referencia para que te construya cosas buenas. Esa es la base".split(" ")
    .map((w, i) => ({ t: 50 + i * 0.3, d: 0.25, w }));
  const [, end] = tightenBoundaries(words, 49.9, 52.75, { duration: 100 });
  assert.ok(end >= 53.55 && end < 53.9, `ends after "buenas.": ${end}`);
  // A clip that already ends on a full stop, a full stop too far away, or a pause on the
  // way to it, ends where it was told.
  assert.ok(tightenBoundaries(words, 49.9, 53.6, { duration: 100 })[1] < 53.9);
  const far = words.map((w) => ({ ...w, w: w.w.replace(".", "") }));
  assert.ok(tightenBoundaries(far, 49.9, 52.75, { duration: 100 })[1] < 52.9);
  const paused = words.map((w, i) => (i >= 9 ? { ...w, t: w.t + 2 } : w));
  assert.ok(tightenBoundaries(paused, 49.9, 52.75, { duration: 100 })[1] < 52.9);
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
  const { redundancyCuts } = await import("../../templates/lib/script");
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
  const { redundancyCuts } = await import("../../templates/lib/script");
  const emphasis = words([[0, 0.2, "muy"], [0.3, 0.2, "muy"], [0.6, 0.4, "bueno"]]);
  assert.deepEqual(redundancyCuts(emphasis, rhythm, 2), []);
  const later = words([
    [0, 0.2, "esto"], [0.25, 0.3, "funciona"],
    [4.0, 0.2, "esto"], [4.25, 0.3, "funciona"],
  ]);
  assert.deepEqual(redundancyCuts(later, rhythm, 6), []);
});

test("punctuation and capitals do not hide a repetition", async () => {
  const { redundancyCuts } = await import("../../templates/lib/script");
  const said = words([
    [0, 0.3, "Entonces,"], [0.4, 0.3, "esto"],
    [0.8, 0.3, "entonces"], [1.2, 0.3, "esto"], [1.6, 0.4, "pasa."],
  ]);
  assert.equal(redundancyCuts(said, rhythm, 3).length, 1);
});

test("a sentence finished and then picked up again is a figure of speech, not a stumble", async () => {
  const { redundancyCuts } = await import("../../templates/lib/script");
  // Straight off a four-hour stream: "el problema siempre es ese 10% extra. Ese 10%
  // extra es donde mueren los proyectos" — the line the clip was chosen for.
  const said = words([
    [0, 0.2, "es"], [0.25, 0.2, "ese"], [0.5, 0.3, "10%"], [0.9, 0.4, "extra."],
    [1.4, 0.2, "Ese"], [1.65, 0.3, "10%"], [2.0, 0.4, "extra"], [2.5, 0.2, "es"], [2.75, 0.3, "donde"],
  ]);
  assert.deepEqual(redundancyCuts(said, rhythm, 4), [], "the first run finished its sentence, so it stays");

  // The same words without the full stop are still a stumble.
  const stumbled = words([
    [0, 0.2, "es"], [0.25, 0.2, "ese"], [0.5, 0.3, "10%"], [0.9, 0.4, "extra"],
    [1.4, 0.2, "ese"], [1.65, 0.3, "10%"], [2.0, 0.4, "extra"], [2.5, 0.2, "es"], [2.75, 0.3, "donde"],
  ]);
  assert.equal(redundancyCuts(stumbled, rhythm, 4).length, 1);
  // A question mark and a closing quote count as finishing it too.
  const asked = words([
    [0, 0.3, "vale"], [0.4, 0.4, "la"], [0.9, 0.4, "pena?\""],
    [1.4, 0.3, "Vale"], [1.8, 0.4, "la"], [2.3, 0.4, "pena"], [2.8, 0.3, "porque"],
  ]);
  assert.deepEqual(redundancyCuts(asked, rhythm, 4), []);
});

test("a disabled rhythm cuts nothing", async () => {
  const { redundancyCuts } = await import("../../templates/lib/script");
  const said = words([[0, 0.2, "y"], [0.25, 0.2, "esto"], [0.5, 0.2, "y"], [0.75, 0.2, "esto"]]);
  assert.deepEqual(redundancyCuts(said, { ...rhythm, enabled: false }, 2), []);
});

test("a crop keyframe and an emphasis are read on the clock the frames are drawn on", async () => {
  const { mapCrop, mapWindow } = await import("../../editor/lib/timeline");
  const map = buildTimeMap(clip(0, 10, [{ type: "silence", t: 1, d: 2 }]));
  assert.deepEqual(mapCrop(map, [{ t: 0, x: 0, y: 0, w: 10, h: 10 }, { t: 6, x: 90, y: 0, w: 10, h: 10 }]).map((k) => k.t), [0, 4]);
  assert.deepEqual(mapWindow(map, 6, 1), { t: 4, d: 1 });
  // A keyframe inside the cut lands on the cut's edge: that is where the footage went.
  assert.deepEqual(mapCrop(map, [{ t: 2, x: 0, y: 0, w: 10, h: 10 }]).map((k) => k.t), [1]);
});

test("edits written against the proposed boundaries move with the settled ones", async (t) => {
  const fs = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agentcut-boundaries-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  // The agent proposes a clip that opens ten seconds before anyone speaks, and puts a
  // punch on the line at source second 33 — three seconds into the clip as it saw it.
  await fs.writeFile(path.join(dir, "clips.json"), JSON.stringify({
    clips: [{
      title: "Late start", score: 80, start: 30, end: 40,
      edits: [{ type: "punch", t: 3, d: 1, scale: 1.1 }],
      crop: [{ t: 0, x: 0, y: 0, w: 100, h: 200 }, { t: 3, x: 50, y: 0, w: 100, h: 200 }],
      tags: [], rules: [],
    }],
  }));
  const transcript = {
    language: "es", engine: "test", segments: [],
    words: [[32.9, 0.4, "Esto"], [33.4, 0.5, "importa."]].map(([t, d, w]) => ({ t, d, w })),
  };
  const { buildEdl } = await import("../server/select");
  const edl = await buildEdl({
    projectId: "boundaries", videoPath: "/tmp/none.mp4", dir,
    probe: { width: 100, height: 200, fps: 30, durationSec: 600 } as never,
    transcript: transcript as never, minSec: 1,
  });
  const built = edl.clips[0];
  assert.ok(Math.abs(built.start - 32.65) < 0.01, `the clip starts where the talking does: ${built.start}`);
  const punch = built.edits.find((e) => e.type === "punch")!;
  assert.ok(Math.abs(built.start + punch.t - 33) < 0.01, `the punch stays on source second 33: ${built.start + punch.t}`);
  assert.ok(built.crop.some((k) => k.t === 0), "the clip opens on a keyframe, interpolated at its new start");
  assert.ok(built.words.length === 2, "and carries the words it actually contains");
});

test("loud moments are one peak each, and they come from the whole recording", async () => {
  const { peaksFromCurve } = await import("../server/signals");
  // Four hours at the curve's own half-second cadence: quiet speech throughout, with a
  // two-second reaction every ten minutes. The late ones are the loudest.
  const curve: Array<{ t: number; db: number }> = [];
  const reactions: number[] = [];
  for (let t = 0; t < 4 * 3600; t += 0.5) {
    const index = Math.floor(t / 600);
    const inReaction = t % 600 < 2 && t >= 600;
    if (inReaction && !reactions.includes(index)) reactions.push(index);
    curve.push({ t, db: inReaction ? -20 + index : -40 });
  }
  const peaks = peaksFromCurve(curve);
  assert.equal(peaks.length, reactions.length, "a reaction that lasts four readings is one peak, not four");
  assert.ok(peaks.at(-1)!.t > 4 * 3600 - 700, `the last reaction is still there: ${peaks.at(-1)?.t}`);
  assert.deepEqual(peaks.map(p => p.t), [...peaks].sort((a, b) => a.t - b.t).map(p => p.t), "peaks come back in time order");

  // Past the cap it is the quietest that go, not the latest: a stream full of reactions
  // must not be described by its first four hundred readings.
  const many: Array<{ t: number; db: number }> = [];
  for (let i = 0; i < 1000; i++) {
    // One loud reading every ten seconds, each a little louder than the last, over a
    // floor of quiet ones — so the median sits on the quiet and every reaction crosses.
    many.push({ t: i * 10, db: -20 + i * 0.01 });
    for (let q = 1; q < 20; q++) many.push({ t: i * 10 + q * 0.5, db: -60 });
  }
  const capped = peaksFromCurve(many);
  assert.equal(capped.length, 400);
  assert.ok(capped[0].t > 5000, `the loudest 400 are the late ones here, so the first kept is late: ${capped[0].t}`);
  assert.ok(capped.at(-1)!.t > 9900, "and the very last one survives");
});

test("the last word ends where its sound does, not where the recogniser guessed — \"rapi\" is not \"rápido\"", () => {
  // Measured on a real stream: the recogniser ended "rápido." at 2033.40, and the sound
  // of it ran until 2033.76. Cutting on the words kept "rapi".
  const said = words([[2032.8, 0.18, "tokens"], [2032.99, 0.06, "muy"], [2033.24, 0.16, "rápido."]]);
  const speech = [{ start: 2032.78, end: 2033.1 }, { start: 2033.22, end: 2033.76 }];
  const [, onWords] = tightenBoundaries(said, 2030, 2033.4, { duration: 18000, fps: 30 });
  assert.ok(onWords < 2033.76, `on the words alone it still stops early: ${onWords}`);
  const [, end] = tightenBoundaries(said, 2030, 2033.4, { duration: 18000, fps: 30, speech });
  assert.ok(end >= 2033.76 + 0.07, `the whole word, and its decay: ${end}`);
});

test("the sound carries a word to its end, but never into the next one or a whole phrase further", () => {
  const said = words([[10, 0.3, "fin."], [10.6, 0.4, "siguiente"]]);
  // One run over both words: the gap between them is too short for the envelope to see.
  const [, end] = tightenBoundaries(said, 5, 10.3, { duration: 600, fps: 30, speech: [{ start: 9.95, end: 11.1 }] });
  assert.ok(end <= 10.55 + 1e-9, `stops before the next word starts: ${end}`);
  // A run that goes on for seconds is somebody still talking, not the last word decaying.
  const alone = words([[20, 0.3, "fin."]]);
  const [, far] = tightenBoundaries(alone, 15, 20.3, { duration: 600, fps: 30, speech: [{ start: 19.9, end: 24 }] });
  assert.ok(far < 21, `does not follow a run that is another phrase: ${far}`);
});

test("the first word starts no later than its sound, so the clip does not open on half a syllable", () => {
  const said = words([[2003.06, 0.15, "¿Pagas"], [2003.35, 0.25, "Claude?"]]);
  const [start] = tightenBoundaries(said, 2003.06, 2010, { duration: 18000, fps: 30, speech: [{ start: 2002.98, end: 2003.62 }] });
  assert.ok(start <= 2002.96, `opens on the onset: ${start}`);
});

test("a clip whose comment pops in keeps the beat of silence before the reading, and only silence", () => {
  const said = words([[1990, 0.4, "anterior."], [2003.06, 0.15, "¿Pagas"], [2003.35, 0.25, "Claude?"]]);
  // Without an opening the dead air before the first word goes, down to a quarter second.
  const [plain] = tightenBoundaries(said, 2002.45, 2010, { duration: 18000, fps: 30 });
  assert.ok(Math.abs(plain - 2002.81) < 1e-9, `${plain}`);
  // With one, the video keeps 0.6 s of itself and its hook before the message lands...
  const [opened] = tightenBoundaries(said, 2002.45, 2010, { duration: 18000, fps: 30, openingSec: 0.6 });
  assert.ok(opened <= 2002.46 + 1e-9 && opened >= 2002.4, `at least 0.6 s of it, as proposed: ${opened}`);
  // ...reaching back for it when the proposal started on the word...
  const [reached] = tightenBoundaries(said, 2003.06, 2010, { duration: 18000, fps: 30, openingSec: 0.6 });
  assert.ok(Math.abs(reached - 2002.46) < 1e-9, `${reached}`);
  // ...but never into the sentence before it.
  const close = words([[2002.5, 0.4, "anterior."], [2003.06, 0.15, "¿Pagas"]]);
  const [bounded] = tightenBoundaries(close, 2003.06, 2010, { duration: 18000, fps: 30, openingSec: 0.6 });
  assert.ok(bounded >= 2002.9 + 0.1 - 1e-9, `${bounded}`);
});

test("a selection run never writes over the project's own glossary or preferences", async () => {
  // It works in the project folder, where these two names are the project-level settings:
  // a copy written there froze the workspace glossary into a project override, and the
  // owner's later corrections ("Codets" is Codex) silently stopped applying.
  const fs = await import("node:fs/promises");
  const source = await fs.readFile(new URL("../server/select.ts", import.meta.url), "utf8");
  for (const name of ["glossary.json", "preferences.md"]) {
    assert.ok(!source.includes(`path.join(dir, "${name}")`), `select.ts writes ${name} into the project folder`);
  }
  const { SELECTION_GLOSSARY, SELECTION_PREFERENCES } = await import("../data");
  assert.notEqual(SELECTION_GLOSSARY, "glossary.json");
  assert.notEqual(SELECTION_PREFERENCES, "preferences.md");
});
