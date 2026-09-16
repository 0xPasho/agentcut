import type { Clip, Edit } from "./edl";
import type { Word } from "./transcript";

/** A span of source time that survives into the output. */
export type KeptSpan = {
  srcStart: number;
  srcEnd: number;
  outStart: number;
};

export type TimeMap = {
  spans: KeptSpan[];
  /** Output duration after silence removal, seconds. */
  duration: number;
};

const MIN_SPAN = 0.08;

/**
 * Silence cuts remove time, so output timestamps drift from source ones.
 * Build the map once; everything else (captions, punches, overlays) goes through it.
 */
export function buildTimeMap(clip: Clip): TimeMap {
  const clipDuration = clip.end - clip.start;
  const cuts = clip.edits
    .filter((e): e is Extract<Edit, { type: "silence" }> => e.type === "silence")
    .map((e) => ({ start: Math.max(0, e.t), end: Math.min(clipDuration, e.t + e.d) }))
    .filter((c) => c.end > c.start)
    .sort((a, b) => a.start - b.start);

  // Merge overlapping cuts so a double-specified silence doesn't drop twice.
  const merged: typeof cuts = [];
  for (const c of cuts) {
    const last = merged[merged.length - 1];
    if (last && c.start <= last.end) last.end = Math.max(last.end, c.end);
    else merged.push({ ...c });
  }

  const spans: KeptSpan[] = [];
  let cursor = 0;
  let out = 0;
  for (const cut of merged) {
    if (cut.start - cursor >= MIN_SPAN) {
      spans.push({ srcStart: cursor, srcEnd: cut.start, outStart: out });
      out += cut.start - cursor;
    }
    cursor = Math.max(cursor, cut.end);
  }
  if (clipDuration - cursor >= MIN_SPAN) {
    spans.push({ srcStart: cursor, srcEnd: clipDuration, outStart: out });
    out += clipDuration - cursor;
  }
  if (!spans.length) {
    return { spans: [{ srcStart: 0, srcEnd: clipDuration, outStart: 0 }], duration: clipDuration };
  }
  return { spans, duration: out };
}

/** Clip-relative source seconds -> output seconds. Times inside a cut snap to the cut's edge. */
export function srcToOut(map: TimeMap, t: number): number {
  for (const s of map.spans) {
    if (t < s.srcStart) return s.outStart;
    if (t <= s.srcEnd) return s.outStart + (t - s.srcStart);
  }
  return map.duration;
}

export function isCut(map: TimeMap, t: number): boolean {
  return !map.spans.some((s) => t >= s.srcStart && t <= s.srcEnd);
}

/** Drop words that fall inside a cut, and remap the survivors to output time. */
export function mapWords(map: TimeMap, words: Word[]): Word[] {
  return words
    .filter((w) => !isCut(map, w.t + w.d / 2))
    .map((w) => {
      const t = srcToOut(map, w.t);
      return { w: w.w, t, d: Math.max(0.04, srcToOut(map, w.t + w.d) - t) };
    });
}

/** Group words into caption lines that fit `maxWords` and never straddle a long pause. */
export function toLines(words: Word[], maxWords: number, pauseGap = 0.6) {
  const lines: Array<{ start: number; end: number; words: Word[] }> = [];
  let current: Word[] = [];

  const flush = () => {
    if (!current.length) return;
    lines.push({
      start: current[0].t,
      end: current[current.length - 1].t + current[current.length - 1].d,
      words: current,
    });
    current = [];
  };

  for (const w of words) {
    const prev = current[current.length - 1];
    if (prev && w.t - (prev.t + prev.d) > pauseGap) flush();
    current.push(w);
    if (current.length >= maxWords || /[.!?]$/.test(w.w)) flush();
  }
  flush();
  return lines;
}
