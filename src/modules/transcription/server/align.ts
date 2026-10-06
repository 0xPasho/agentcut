import fs from "node:fs/promises";
import { fold, type Word } from "../lib/transcript";

/** A stretch of audio that actually contains speech, in seconds. */
export type SpeechRun = { start: number; end: number };

const HOP_MS = 10;

/**
 * Whisper reports word times against its own 20ms decoder grid, and the value it
 * picks is a guess derived from token probabilities — good to roughly a tenth of a
 * second, which is exactly the error a karaoke highlight makes visible. The audio
 * itself is the ground truth for *when* a word starts, so the envelope below is
 * what the guessed times get snapped to.
 */
export function frameLevels(pcm: Int16Array, sampleRate: number, hopMs = HOP_MS): number[] {
  const hop = Math.max(1, Math.round((sampleRate * hopMs) / 1000));
  const out: number[] = [];
  for (let i = 0; i + hop <= pcm.length; i += hop) {
    let sum = 0;
    for (let k = 0; k < hop; k++) {
      const s = pcm[i + k] / 32768;
      sum += s * s;
    }
    out.push(20 * Math.log10(Math.sqrt(sum / hop) + 1e-9));
  }
  return out;
}

/**
 * Speech/silence segmentation from the level envelope. The threshold is relative to
 * the recording's own noise floor rather than a fixed dB, so a quiet mic and a loud
 * one segment the same way.
 */
export function speechRuns(levels: number[], hopMs = HOP_MS): SpeechRun[] {
  if (!levels.length) return [];
  const sorted = [...levels].sort((a, b) => a - b);
  const pct = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  const floor = pct(0.2);
  const loud = pct(0.95);
  // Anything under 6dB of headroom over the floor is room tone, not speech.
  const threshold = Math.max(floor + 6, floor + 0.35 * (loud - floor));

  const speech = levels.map((v) => v > threshold);
  const closeFrames = Math.round(80 / hopMs); // gaps this short are stops inside a word
  const minFrames = Math.round(50 / hopMs); // shorter bursts are clicks and breaths

  for (let i = 0; i < speech.length; i++) {
    if (speech[i]) continue;
    let j = i;
    while (j < speech.length && !speech[j]) j++;
    if (j - i <= closeFrames && i > 0 && j < speech.length) for (let k = i; k < j; k++) speech[k] = true;
    i = j - 1;
  }
  for (let i = 0; i < speech.length; i++) {
    if (!speech[i]) continue;
    let j = i;
    while (j < speech.length && speech[j]) j++;
    if (j - i < minFrames) for (let k = i; k < j; k++) speech[k] = false;
    i = j - 1;
  }

  const runs: SpeechRun[] = [];
  for (let i = 0; i < speech.length; i++) {
    if (!speech[i]) continue;
    let j = i;
    while (j < speech.length && speech[j]) j++;
    runs.push({ start: (i * hopMs) / 1000, end: (j * hopMs) / 1000 });
    i = j - 1;
  }
  return runs;
}

/** 16-bit PCM WAV only — what media.extractAudio writes. Returns null for anything else. */
export async function readWavMono(file: string): Promise<{ pcm: Int16Array; sampleRate: number } | null> {
  const buf = await fs.readFile(file).catch(() => null);
  if (!buf || buf.length < 44 || buf.toString("ascii", 0, 4) !== "RIFF") return null;

  let offset = 12;
  let channels = 1;
  let sampleRate = 16000;
  let bits = 16;
  while (offset + 8 <= buf.length) {
    const id = buf.toString("ascii", offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === "fmt ") {
      channels = buf.readUInt16LE(body + 2);
      sampleRate = buf.readUInt32LE(body + 4);
      bits = buf.readUInt16LE(body + 14);
    } else if (id === "data") {
      if (bits !== 16 || channels !== 1) return null;
      const count = Math.floor(Math.min(size, buf.length - body) / 2);
      const pcm = new Int16Array(count);
      for (let i = 0; i < count; i++) pcm[i] = buf.readInt16LE(body + i * 2);
      return { pcm, sampleRate };
    }
    offset = body + size + (size % 2);
  }
  return null;
}

export async function speechRunsFromWav(file: string): Promise<SpeechRun[]> {
  const wav = await readWavMono(file);
  if (!wav) return [];
  return speechRuns(frameLevels(wav.pcm, wav.sampleRate));
}

const MIN_WORD = 0.06;
/** How far a word start may be pulled back onto an onset it overshot. */
const SNAP_BACK = 0.2;
/** How far a word start may be pushed forward out of silence onto the next onset. */
const SNAP_FORWARD = 0.3;

/**
 * Snap word times onto the audio.
 *
 * Only the first word of a speech run moves: inside continuous speech there is no
 * onset to snap to, and guessing would be worse than whisper's own estimate. That
 * covers the visible cases — a highlight that lights up during a pause, or one that
 * lags the first word after a breath.
 *
 * Words also stop when their run stops, so a highlight never trails into silence.
 */
export function refineWordTimes(words: Word[], runs: SpeechRun[]): Word[] {
  if (!runs.length || !words.length) return words;
  const out = words.map((w) => ({ ...w }));

  const runAt = (t: number) => runs.find((r) => t >= r.start && t <= r.end) ?? null;
  const runAfter = (t: number) => runs.find((r) => r.start >= t) ?? null;
  const runBefore = (t: number) => {
    let found: SpeechRun | null = null;
    for (const r of runs) {
      if (r.end <= t) found = r;
      else break;
    }
    return found;
  };

  let prevStart = -Infinity;
  for (const word of out) {
    const inRun = runAt(word.t);
    let t = word.t;
    if (inRun) {
      // First word of this run: whisper's estimate and the onset describe the same
      // moment, so trust the onset. Later words in the run keep their estimate.
      if (inRun.start > prevStart && word.t - inRun.start <= SNAP_BACK) t = inRun.start;
    } else {
      const next = runAfter(word.t);
      const prev = runBefore(word.t);
      if (next && next.start - word.t <= SNAP_FORWARD && next.start > prevStart) t = next.start;
      else if (prev && word.t - prev.end <= SNAP_BACK) t = prev.end - 0.02;
    }
    word.t = Math.max(t, prevStart + 0.02);
    prevStart = word.t;
  }

  for (let i = 0; i < out.length; i++) {
    const word = out[i];
    const run = runAt(word.t) ?? runAt(word.t + 0.01);
    const next = out[i + 1];
    let end = word.t + word.d;
    if (next) end = Math.min(end, next.t);
    // A word cannot still be sounding after its own speech run ended.
    if (run && next && next.t > run.end) end = Math.min(end, run.end);
    word.d = Math.max(MIN_WORD, end - word.t);
  }
  return out;
}

/** How far a segment's words may sit from its start before they are a different timeline. */
const SAME_TIMELINE = 0.05;

/**
 * Put a segment's words back onto the source's clock.
 *
 * With VAD on, whisper.cpp decodes the speech-only audio it stitched together and
 * maps only its *segment* timestamps back onto the original file — token times,
 * `offsets` and `t_dtw` alike, stay in the compressed timeline. Every word is then
 * early by all the silence cut out before it, which after an hour of a stream is
 * minutes: captions read out a completely different part of the video.
 *
 * The segment's own start and end are the two trustworthy anchors. Words are walked
 * across the speech inside them, so silence that VAD removed mid-segment is put
 * back where it was rather than smeared over the words.
 */
export function rebaseOntoSource(words: Word[], seg: { start: number; end: number }, runs: SpeechRun[]): Word[] {
  if (!words.length) return words;
  const base = words[0].t;
  // No VAD, or nothing removed before this segment: the times are already the source's.
  if (Math.abs(seg.start - base) < SAME_TIMELINE) return words;
  return spreadOverSpeech(words.map((w) => ({ ...w, t: w.t - base })), seg, runs);
}

/**
 * Lay words timed from zero across the speech inside a segment.
 *
 * The words' own spacing is kept, scaled to the speech the envelope finds between the
 * segment's bounds, and silence inside the segment is stepped over rather than smeared
 * across the words. With no speech found they are laid across the segment as they are.
 * Whisper's VAD rebase and a transcript that is timed per line both place words this
 * way, so the two cannot disagree about where a word lands.
 */
export function spreadOverSpeech(words: Word[], seg: { start: number; end: number }, runs: SpeechRun[]): Word[] {
  if (!words.length) return words;
  const last = words[words.length - 1];
  const spoken = Math.max(0, last.t + last.d);
  const inside = runs
    .filter((r) => r.end > seg.start && r.start < seg.end)
    .map((r) => ({ start: Math.max(r.start, seg.start), end: Math.min(r.end, seg.end) }));
  const speech = inside.reduce((total, r) => total + (r.end - r.start), 0);
  // Our own speech detection and Silero's rarely agree to the frame; fitting the
  // words to the speech we can see keeps the last one from running past the segment.
  const scale = spoken > 0.01 && speech > 0.01 ? speech / spoken : 1;

  // A word that fills a run exactly ends where the run ends, but the next one
  // starts after the pause — so where a run boundary lands depends on which edge
  // of a word is being placed.
  const at = (t: number, edge: "start" | "end"): { at: number; run: number } => {
    let left = Math.max(0, t) * scale;
    for (const [index, run] of inside.entries()) {
      const dur = run.end - run.start;
      if (left < dur || (edge === "end" && left <= dur)) return { at: run.start + left, run: index };
      left -= dur;
    }
    const tail = inside.length ? inside[inside.length - 1].end : seg.start;
    return { at: Math.min(seg.end, tail + left), run: inside.length };
  };

  return words.map((w) => {
    const start = at(w.t, "start");
    const end = at(w.t + w.d, "end");
    let t = start.at;
    let stop = end.at;
    // A word is said on one side of a silence or the other, never across it: stretched
    // over the pause it claims the dead air — the cut that should take the pause out
    // refuses, and a caption sits lit on nothing. It keeps the side holding most of it.
    if (end.run !== start.run && start.run < inside.length && end.run < inside.length) {
      const before = inside[start.run].end - t;
      const after = stop - inside[end.run].start;
      if (before >= after) stop = inside[start.run].end;
      else t = inside[end.run].start;
    }
    return { ...w, t, d: Math.max(0.01, stop - t) };
  });
}

/**
 * How far from where a transcript timed per line places a word the recogniser may hear
 * it and still be hearing that word. Spreading a line's words by their length puts them
 * up to a couple of seconds from where they are said, inside a long line with a pause.
 */
const PAIR_WITHIN_SEC = 5;
/** How much nearer in time weighs between pairings that agree on as many words. */
const NEARER = 0.01;

function editDistance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) {
      next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    row = next;
  }
  return row[b.length];
}

/**
 * How alike two folded words are, 0..1: 1 for the same word, the share of letters they
 * agree on for one name spelled two ways ("pashoai", "pachoyay"), 0 for two words.
 * Short words have to agree exactly: "de" and "da" are different words.
 */
function likeness(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (Math.min(a.length, b.length) < 4) return 0;
  const score = 1 - editDistance(a, b) / Math.max(a.length, b.length);
  return score >= 0.6 ? score : 0;
}

/**
 * Which heard word each said word is, or -1.
 *
 * A transcript and the recogniser rarely write every word alike — a number as a digit
 * in one and spelled out in the other, a name spelled two ways, a stammer only one of
 * them kept — so this is the in-order pairing that agrees on the most, not a walk word
 * by word that one disagreement would throw off for the rest of the line. A word is
 * only paired with one heard near where the transcript places it: "que" said here is
 * not the "que" heard half a minute later.
 */
export function pairWords(said: Word[], heard: Word[], withinSec = PAIR_WITHIN_SEC): number[] {
  const a = said.map((w) => fold(w.w));
  const b = heard.map((w) => fold(w.w));
  // Between two pairings that agree on as many words, the nearer one: "lo que se le…
  // lo que yo le llamo" heard as one "lo que" is the second one, said right where it was
  // heard, not the first one, a second and a half away. The nudge is far smaller than
  // any word's worth, so it only ever breaks ties.
  const like = (i: number, j: number) => {
    const apart = Math.abs(said[i].t - heard[j].t);
    if (apart > withinSec) return 0;
    const alike = likeness(a[i], b[j]);
    return alike > 0 ? alike - NEARER * (apart / withinSec) : 0;
  };
  // best[i][j]: the most the words from said[i] and heard[j] on can agree.
  const best = Array.from({ length: said.length + 1 }, () => new Float64Array(heard.length + 1));
  for (let i = said.length - 1; i >= 0; i--) {
    for (let j = heard.length - 1; j >= 0; j--) {
      const pair = like(i, j);
      best[i][j] = Math.max(best[i + 1][j], best[i][j + 1], pair > 0 ? pair + best[i + 1][j + 1] : 0);
    }
  }
  const pairs = new Array<number>(said.length).fill(-1);
  for (let i = 0, j = 0; i < said.length && j < heard.length;) {
    const pair = like(i, j);
    if (pair > 0 && best[i][j] === pair + best[i + 1][j + 1]) pairs[i++] = j++;
    else if (best[i + 1][j] >= best[i][j + 1]) i++;
    else j++;
  }
  return pairs;
}

/**
 * Words whose text is the transcript's and whose times are what the recogniser heard.
 *
 * A said word the recogniser also heard takes that word's start and length. One it did
 * not hear keeps its place between the paired words either side: its own time is carried
 * along with theirs, so a "1º" the recogniser wrote as "primer" lands where "primer" was
 * said, and a word before the first pair or after the last moves as far as that pair
 * did. Unless a third of the words pair, nothing moves: the recogniser heard something
 * else — music, another voice — and a word or two that happen to match are no evidence.
 */
export function timeFromHeard(said: Word[], heard: Word[]): Word[] {
  const pairs = pairWords(said, heard);
  if (pairs.filter((j) => j >= 0).length < Math.max(1, said.length / 3)) return said;
  // Each pair pins a start and an end of the transcript's clock to the recogniser's.
  const pins: Array<[number, number]> = [];
  pairs.forEach((j, i) => {
    if (j >= 0) pins.push([said[i].t, heard[j].t], [said[i].t + said[i].d, heard[j].t + heard[j].d]);
  });
  const warp = (x: number) => {
    const first = pins[0];
    const last = pins[pins.length - 1];
    if (x <= first[0]) return x + first[1] - first[0];
    if (x >= last[0]) return x + last[1] - last[0];
    let lo = 0;
    let hi = pins.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (pins[mid][0] <= x) lo = mid;
      else hi = mid;
    }
    const [x0, y0] = pins[lo];
    const [x1, y1] = pins[hi];
    return x1 > x0 ? y0 + ((x - x0) / (x1 - x0)) * (y1 - y0) : y0;
  };
  const timed = said.map((w, i) => {
    const j = pairs[i];
    if (j >= 0) return { ...w, t: heard[j].t, d: heard[j].d };
    const t = warp(w.t);
    return { ...w, t, d: warp(w.t + w.d) - t };
  });
  return inOrder(timed);
}

/**
 * Words one after another, whatever placed them: each starts after the one before it and
 * ends by the time the next one starts. Words timed in separate passes meet here.
 */
export function inOrder(words: Word[]): Word[] {
  const out = words.map((w) => ({ ...w }));
  for (let i = 1; i < out.length; i++) out[i].t = Math.max(out[i].t, out[i - 1].t + 0.01);
  for (let i = 0; i < out.length; i++) {
    const next = out[i + 1];
    const end = next ? Math.min(out[i].t + out[i].d, next.t) : out[i].t + out[i].d;
    out[i].d = Math.max(0.01, end - out[i].t);
  }
  return out;
}
