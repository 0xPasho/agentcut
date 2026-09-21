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

/** A kept span as whole output frames: where it starts in the programme, and how long it holds. */
export type SpanFrames = KeptSpan & { from: number; durationInFrames: number };

/**
 * The kept spans in frames, tiled without a gap between them.
 *
 * Rounding each span's length on its own is what puts a black frame on a splice:
 * `round(a) + round(b)` is not `round(a + b)`, so two spans that meet in seconds can
 * end a frame apart in frames and the renderer shows nothing in between. Rounding the
 * cumulative boundary instead makes every span begin exactly where the previous one
 * ended, and the last one end exactly on the clip's own frame count.
 */
export function spanFrames(map: TimeMap, fps: number): SpanFrames[] {
  const frames: SpanFrames[] = [];
  for (const span of map.spans) {
    const previous = frames.at(-1);
    // Contiguity is structural: a span begins on the frame the one before it ended,
    // never on a rounding of its own start that can land a frame away from it.
    const from = previous ? previous.from + previous.durationInFrames : Math.round(span.outStart * fps);
    const until = Math.max(from + 1, Math.round((span.outStart + span.srcEnd - span.srcStart) * fps));
    frames.push({ ...span, from, durationInFrames: until - from });
  }
  return frames;
}

/** How many frames a clip occupies. The same arithmetic the spans are tiled with. */
export function clipFrames(map: TimeMap, fps: number): number {
  const last = spanFrames(map, fps).at(-1);
  return Math.max(1, last ? last.from + last.durationInFrames : 0);
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
      return { ...w, t, d: Math.max(0.04, srcToOut(map, w.t + w.d) - t) };
    });
}

/** A word stays lit until the next one starts, but never through a long pause. */
export const WORD_HOLD = 0.25;
/** A line appears slightly before its first word and lingers after its last. */
export const LINE_LEAD = 0.15;
export const LINE_TAIL = 0.35;

export type CaptionLine = { start: number; end: number; words: Word[] };

/**
 * The line on screen at `t`: the last one that has started, not the first that
 * matches. Their windows overlap, and preferring the earlier one leaves the next
 * line's opening words being spoken with the previous line still up.
 */
export function lineAt(lines: CaptionLine[], t: number): CaptionLine | null {
  let found: CaptionLine | null = null;
  for (const line of lines) {
    if (t >= line.start - LINE_LEAD) found = line;
    else break;
  }
  if (!found || t > found.end + LINE_TAIL) return null;
  return found;
}

/**
 * Which word is being spoken at `t`: the last one that has started, lit until the
 * next one starts. Running to the next word rather than to this word's own end is
 * what removes the flicker in the gaps between recogniser word times — but a line's
 * final word still goes dark rather than holding through the pause after it.
 */
export function activeWordIndex(words: Word[], t: number): number {
  let index = -1;
  for (let i = 0; i < words.length; i++) {
    if (t >= words[i].t) index = i;
    else break;
  }
  if (index < 0) return -1;
  const current = words[index];
  const next = words[index + 1];
  const until = Math.min(next ? next.t : Infinity, current.t + current.d + WORD_HOLD);
  return t > until ? -1 : index;
}

/**
 * Which words a preset puts on screen at this moment.
 *
 * `popline` shows one word at a time, so between words — and before the first one —
 * it shows nothing at all. The line-reading presets always show the whole line.
 */
export function visibleWords(
  words: Word[],
  activeIndex: number,
  preset: "karaoke" | "popline" | "boxed" | "none",
): Word[] {
  if (preset === "none") return [];
  if (preset !== "popline") return words;
  return activeIndex >= 0 && words[activeIndex] ? [words[activeIndex]] : [];
}

/** Group words into caption lines that fit `maxWords` and never straddle a long pause. */
export function toLines(words: Word[], maxWords: number, pauseGap = 0.6): CaptionLine[] {
  const lines: CaptionLine[] = [];
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
