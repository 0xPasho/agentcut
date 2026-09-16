import { z } from "zod";

export const Word = z.object({
  t: z.number(), // start, seconds
  d: z.number(), // duration, seconds
  w: z.string(),
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
  segments: z.array(Segment),
  words: z.array(Word).default([]),
});
export type Transcript = z.infer<typeof Transcript>;

export function wordsBetween(t: Transcript, start: number, end: number): Word[] {
  return t.words.filter((w) => w.t + w.d > start && w.t < end);
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
