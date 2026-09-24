import test from "node:test";
import assert from "node:assert/strict";
import { TemplateRhythm } from "../types";
import { fillerCuts, retakeCuts } from "../lib/cleanup";

/**
 * The two passes that cut *speech*: the stall, and the take that was said again.
 * Everything here is a transcript the way a recogniser writes one — words with a start
 * and a length, punctuation attached — because that is the only thing either pass gets.
 */

const words = (rows: Array<[number, number, string]>) => rows.map(([t, d, w]) => ({ t, d, w }));

const rhythm = TemplateRhythm.parse({});
const filler = { ...rhythm.filler, enabled: true };
const retake = { ...rhythm.retake, enabled: true };

test("a stall goes, and the hesitation around it goes with it", () => {
  // "so… uh… the thing is": one hole, not a word between two pauses.
  const said = words([[0, 0.3, "So"], [0.9, 0.3, "uh"], [1.7, 0.3, "the"], [2.1, 0.3, "thing"]]);
  const cuts = fillerCuts(said, filler, 3);
  assert.equal(cuts.length, 1);
  assert.ok(Math.abs(cuts[0].t - 0.4) < 0.001, `the cut opens a breath after "So": ${cuts[0].t}`);
  assert.ok(Math.abs(cuts[0].t + cuts[0].d - 1.6) < 0.001, `and closes a breath before "the": ${cuts[0].d}`);
});

test("two stalls in a row are one hole", () => {
  const said = words([[0, 0.3, "I"], [0.4, 0.3, "um"], [0.8, 0.3, "uh"], [1.4, 0.4, "think"]]);
  const cuts = fillerCuts(said, filler, 2);
  assert.equal(cuts.length, 1, "otherwise the gap between the two stalls survives");
  assert.ok(cuts[0].t > 0.3 && cuts[0].t + cuts[0].d < 1.4);
});

test("the words that are a voice are not stalls", () => {
  // Measured on three published news videos: "like" survives 1.3-1.7 times a minute and
  // "so" 1.4-1.8, against 0.04 for "uh". Cutting these would not tighten the video.
  const said = words([[0, 0.3, "It's"], [0.4, 0.3, "like"], [0.8, 0.3, "so"], [1.2, 0.4, "actually"], [1.7, 0.4, "right?"]]);
  assert.deepEqual(fillerCuts(said, filler, 2.5), []);
});

test("a hum held on purpose is not a stall, and a shot of nothing but hesitation is left alone", () => {
  const held = words([[0, 0.4, "Well"], [0.6, 1.6, "hmmm"], [2.4, 0.4, "maybe"]]);
  assert.deepEqual(fillerCuts(held, filler, 3), [], "a second and a half of humming is doing something");
  const nothing = words([[0, 0.3, "um"], [0.5, 0.3, "uh"]]);
  assert.deepEqual(fillerCuts(nothing, filler, 1), [], "there would be nothing left of the shot");
});

test("a stall pass nobody asked for cuts nothing", () => {
  const said = words([[0, 0.3, "I"], [0.5, 0.3, "uh"], [1.0, 0.3, "think"]]);
  assert.deepEqual(fillerCuts(said, rhythm.filler, 2), [], "off unless a template asks for it");
  assert.equal(fillerCuts(said, filler, 2).length, 1);
});

test("a sentence started, given up on and started again loses the first attempt", () => {
  // "como dije antes, el— como dije antes, este modelo es el bueno"
  const said = words([
    [0, 0.3, "como"], [0.35, 0.3, "dije"], [0.7, 0.4, "antes"], [1.15, 0.2, "el"],
    [1.9, 0.3, "como"], [2.25, 0.3, "dije"], [2.6, 0.4, "antes"], [3.05, 0.3, "este"],
    [3.4, 0.4, "modelo"], [3.85, 0.2, "es"], [4.1, 0.2, "el"], [4.35, 0.4, "bueno."],
  ]);
  const cuts = retakeCuts(said, retake, 5);
  assert.equal(cuts.length, 1);
  assert.equal(cuts[0].t, 0, "the abandoned take goes whole, from its first word");
  assert.ok(Math.abs(cuts[0].t + cuts[0].d - 1.8) < 0.001, `and ends a breath before the second: ${cuts[0].d}`);
});

test("a restart is found even when the transcriber wrote no pause and no full stop", () => {
  // The case nothing else catches: not adjacent — there are words of the abandoned take
  // in between — and not word for word, so neither the silence pass nor the exact-repeat
  // pass can see it.
  const said = words([
    [0, 0.3, "as"], [0.35, 0.2, "I"], [0.6, 0.3, "said"], [0.95, 0.4, "before"], [1.4, 0.3, "the"],
    [1.75, 0.3, "as"], [2.1, 0.2, "I"], [2.35, 0.3, "said"], [2.7, 0.4, "before"], [3.15, 0.3, "this"],
    [3.5, 0.4, "model"], [3.95, 0.2, "is"], [4.2, 0.3, "the"], [4.55, 0.3, "one"],
  ]);
  const cuts = retakeCuts(said, retake, 5);
  assert.equal(cuts.length, 1);
  // What little gap there is between the two takes is the breath, so the cut stops at
  // 1.70 and the second take keeps its own first word whole.
  assert.ok(Math.abs(cuts[0].t + cuts[0].d - 1.7) < 0.001, `the second take keeps its first word: ${cuts[0].d}`);
});

test("a stall between the two takes does not hide the restart", () => {
  const said = words([
    [0, 0.3, "the"], [0.35, 0.4, "model"], [0.8, 0.2, "is"],
    [1.2, 0.3, "uh"],
    [1.7, 0.3, "the"], [2.05, 0.4, "model"], [2.5, 0.2, "is"], [2.75, 0.4, "really"], [3.2, 0.4, "fast."],
  ]);
  assert.equal(retakeCuts(said, retake, 4, rhythm.filler.words).length, 1);
});

test("two statements that start the same way are two statements", () => {
  const said = words([
    [0, 0.3, "The"], [0.35, 0.4, "model"], [0.8, 0.2, "is"], [1.05, 0.4, "fast."],
    [1.6, 0.3, "The"], [1.95, 0.4, "model"], [2.4, 0.2, "is"], [2.65, 0.4, "cheap."],
  ]);
  assert.deepEqual(retakeCuts(said, retake, 3.5), [], "the first one goes somewhere the second does not");
});

test("a point picked up again after a pause is a decision, not a stumble", () => {
  const said = words([
    [0, 0.3, "this"], [0.35, 0.4, "changes"], [0.8, 0.5, "everything"],
    [5.0, 0.3, "this"], [5.35, 0.4, "changes"], [5.8, 0.5, "everything"], [6.4, 0.3, "for"], [6.75, 0.2, "us"],
  ]);
  assert.deepEqual(retakeCuts(said, retake, 8), [], "four seconds later, saying it again is deliberate");
});

test("a finished sentence restated for weight keeps both", () => {
  const said = words([
    [0, 0.2, "es"], [0.25, 0.2, "ese"], [0.5, 0.3, "10%"], [0.9, 0.4, "extra."],
    [1.4, 0.2, "Ese"], [1.65, 0.3, "10%"], [2.0, 0.4, "extra"], [2.5, 0.2, "es"], [2.75, 0.3, "donde"], [3.1, 0.4, "mueren"],
  ]);
  assert.deepEqual(retakeCuts(said, retake, 4), [], "the full stop says it was not abandoned");
});

test("a retake pass nobody asked for cuts nothing", () => {
  const said = words([
    [0, 0.3, "como"], [0.35, 0.3, "dije"], [0.7, 0.4, "antes"],
    [1.9, 0.3, "como"], [2.25, 0.3, "dije"], [2.6, 0.4, "antes"], [3.05, 0.3, "esto"], [3.4, 0.4, "pasa."],
  ]);
  assert.deepEqual(retakeCuts(said, rhythm.retake, 4), []);
  assert.equal(retakeCuts(said, retake, 4).length, 1);
});

test("every cut the two passes make is inside the shot", () => {
  const said = words([
    [0, 0.3, "so"], [0.6, 0.3, "um"], [1.2, 0.3, "the"], [1.55, 0.4, "thing"], [2.0, 0.2, "is"],
    [2.6, 0.3, "the"], [2.95, 0.4, "thing"], [3.4, 0.2, "is"], [3.65, 0.4, "simple."],
  ]);
  const duration = 4.2;
  for (const cut of [...fillerCuts(said, filler, duration), ...retakeCuts(said, retake, duration, rhythm.filler.words)]) {
    assert.ok(cut.d > 0, "a cut of no length is not a cut");
    assert.ok(cut.t >= 0 && cut.t + cut.d <= duration, `${cut.t}+${cut.d} runs past ${duration}`);
  }
});

test("the same sound at the end of a sentence is a word, not a stall", () => {
  // Straight off seven hours of a real stream: every "eh" but one was this — "está
  // chida, ¿eh?" — and cutting them took the end of the sentence with them.
  const spanish = { ...filler, words: [...filler.words, "eh"] };
  const tag = words([[0, 0.3, "Está"], [0.4, 0.4, "chida,"], [0.9, 0.3, "¿eh?"], [2.0, 0.4, "Mira."]]);
  assert.deepEqual(fillerCuts(tag, spanish, 3), []);
  // The same sound opening a sentence is a stall, however the transcriber punctuated it.
  const stall = words([[0, 0.4, "escrito."], [0.9, 0.3, "Eh..."], [1.7, 0.3, "No."], [2.2, 0.3, "O"], [2.6, 0.3, "sea."]]);
  assert.equal(fillerCuts(stall, spanish, 3).length, 1);
});

test("a stall does not swallow the dead air around it, which the silence pass reads the sound before cutting", () => {
  const said = words([[0, 0.4, "So"], [6.0, 0.3, "um"], [12.0, 0.4, "anyway"]]);
  const cuts = fillerCuts(said, filler, 13);
  assert.equal(cuts.length, 1);
  assert.ok(cuts[0].d < 3, `it takes the stall and a little either side, not eleven seconds: ${cuts[0].d}`);
  assert.ok(cuts[0].t >= 4.8 && cuts[0].t + cuts[0].d <= 7.5, `it reaches ${filler.maxWordSec}s into each side and no further`);
});

test("two alternatives that share a frame are a list, not a take said twice", () => {
  // "puedes abrir un YouTube, puedes abrir un Software": four words of five line up and
  // dropping the first loses YouTube. The take that stopped has to be left hanging on
  // grammar — "como dije antes, el—" — not on a word that carries meaning.
  const list = words([
    [0, 0.3, "puedes"], [0.35, 0.3, "abrir"], [0.7, 0.2, "un"], [0.95, 0.5, "YouTube,"],
    [1.6, 0.3, "puedes"], [1.95, 0.3, "abrir"], [2.3, 0.2, "un"], [2.55, 0.5, "Software,"], [3.1, 0.3, "puedes"],
  ]);
  assert.deepEqual(retakeCuts(list, retake, 4), []);
  const alternatives = words([
    [0, 0.3, "para"], [0.35, 0.5, "preguntas"], [0.9, 0.2, "o"], [1.15, 0.2, "es"], [1.4, 0.3, "solo"],
    [1.8, 0.3, "para"], [2.15, 0.4, "código"], [2.6, 0.2, "o"], [2.85, 0.2, "es"], [3.1, 0.3, "solo"], [3.5, 0.5, "organizador"],
  ]);
  assert.deepEqual(retakeCuts(alternatives, retake, 4.2), [], "one word in common at the front is a coincidence");
});
