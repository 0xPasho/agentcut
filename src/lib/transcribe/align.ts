import fs from "node:fs/promises";
import type { Word } from "../transcript";

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
