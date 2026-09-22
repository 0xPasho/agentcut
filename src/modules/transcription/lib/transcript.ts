import { z } from "zod";

export const Word = z.object({
  t: z.number(), // start, seconds
  d: z.number(), // duration, seconds
  w: z.string(),
  /**
   * Recogniser confidence, 0..1. Optional: hand-made words and transcripts from
   * before the recogniser reported it simply have none, and absent means certain.
   */
  p: z.number().min(0).max(1).optional(),
});
export type Word = z.infer<typeof Word>;

export const Segment = z.object({
  start: z.number(),
  end: z.number(),
  text: z.string(),
  speaker: z.string().nullable().default(null),
});
export type Segment = z.infer<typeof Segment>;

export const Transcript = z.object({
  language: z.string().default("en"),
  /**
   * Which recogniser settings produced this. A cached transcript from an older,
   * less accurate engine is re-run rather than reused — see jobs.analyze.
   */
  engine: z.string().default(""),
  segments: z.array(Segment),
  words: z.array(Word).default([]),
});
export type Transcript = z.infer<typeof Transcript>;

export function wordsBetween(t: Transcript, start: number, end: number): Word[] {
  return t.words.filter((w) => w.t + w.d > start && w.t < end);
}

/**
 * The words of a clip, in clip-relative seconds. Clips store their own copy, so
 * this is the one place that rebases source time onto a clip — selection and a
 * later re-transcribe must place identical words at identical times.
 */
export function wordsForClip(t: Transcript, start: number, end: number): Word[] {
  return wordsBetween(t, start, end)
    .map((w) => ({
      ...w,
      t: Math.max(0, w.t - start),
      d: Math.min(w.t + w.d, end) - Math.max(w.t, start),
    }))
    .filter((w) => w.d > 0);
}

/** Compact, line-numbered view with timestamps — what the agent reads. */
export function toAgentText(t: Transcript): string {
  return t.segments
    .map((s, i) => `[${i}] ${fmt(s.start)}-${fmt(s.end)}${s.speaker ? ` ${s.speaker}:` : ""} ${s.text.trim()}`)
    .join("\n");
}

export function fmt(sec: number): string {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = (s % 60).toFixed(2).padStart(5, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${r}` : `${m}:${r}`;
}
