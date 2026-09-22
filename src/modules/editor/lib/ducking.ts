import type { Word } from "../../transcription/lib/transcript";

const DUCK_GAIN = 0.25;
/** Ramp length in seconds — short enough to feel tight, long enough not to pump. */
const RAMP = 0.15;
/** Gaps shorter than this aren't worth ducking back up for. */
const MIN_GAP = 0.6;

export type Span = { start: number; end: number };

/** Merge words into continuous speech runs, in whatever timebase they're in. */
export function speechSpans(words: Word[]): Span[] {
  const spans: Span[] = [];
  for (const w of words) {
    const last = spans[spans.length - 1];
    if (last && w.t - last.end < MIN_GAP) last.end = Math.max(last.end, w.t + w.d);
    else spans.push({ start: w.t, end: w.t + w.d });
  }
  return spans;
}

/**
 * Music volume at time `t`: full gain in the gaps, ducked under speech, with a
 * ramp on either side so it breathes instead of stepping.
 */
export function duckedVolume(spans: Span[], t: number, gain: number): number {
  for (const s of spans) {
    if (t < s.start - RAMP || t > s.end + RAMP) continue;
    if (t >= s.start && t <= s.end) return gain * DUCK_GAIN;
    const edge = t < s.start ? (s.start - t) / RAMP : (t - s.end) / RAMP;
    // edge runs 0 (at the speech) to 1 (clear of it)
    return gain * (DUCK_GAIN + (1 - DUCK_GAIN) * Math.min(1, Math.max(0, edge)));
  }
  return gain;
}
