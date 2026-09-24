import type { Segment, Word } from "./transcript";
import type { ParsedTranscript, TranscriptFormat } from "../types";
import { MS_THRESHOLD, PROVIDED_ENGINE, SEGMENT_GAP_SEC, SEGMENT_MAX_SEC, SEGMENT_MIN_SEC, WORD_MAX_SEC } from "../data";

/**
 * Reading a transcript somebody already has.
 *
 * A transcript the person trusts more than the recogniser is the source of truth for
 * what was said, so this reads whatever they are likely to have — subtitles, a
 * recogniser's or a captioning service's JSON, or plain lines with timestamps — and
 * turns it into the same `Transcript` whisper produces. Nothing here touches the audio:
 * a file timed only per line comes back without words, and the server lays them over
 * the speech it finds (`server/provided.ts`).
 */

export const providedEngine = (format: TranscriptFormat) => `${PROVIDED_ENGINE}${format}`;
export const isProvided = (engine: string | null | undefined) => !!engine?.startsWith(PROVIDED_ENGINE);

/** `01:02:03,456`, `1:02:03.4`, `02:03.5` or `2:03`. A bare number is not a clock. */
export function parseClock(raw: string): number | null {
  const parts = raw.trim().replace(",", ".").split(":");
  if (parts.length < 2 || parts.length > 3) return null;
  const last = parts.length - 1;
  if (!parts.every((part, i) => (i === last ? /^\d{1,2}(\.\d+)?$/ : /^\d+$/).test(part))) return null;
  return parts.reduce((total, part) => total * 60 + Number(part), 0);
}

export type ParseOptions = {
  /** The file's name; its extension decides the format when the content alone could be either. */
  name?: string;
  /** How long the source runs, when known — how a clock in milliseconds is told from one in seconds. */
  durationSec?: number;
};

export function parseTranscript(text: string, o: ParseOptions = {}): ParsedTranscript {
  const body = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n").trim();
  if (!body) throw new Error("The transcript is empty.");
  const ext = /\.[a-z0-9]+$/i.exec(o.name ?? "")?.[0].toLowerCase() ?? "";
  const parsed = ext === ".json" || /^[{[]/.test(body)
    ? parseJson(body, o.durationSec)
    : ext === ".vtt" || /^WEBVTT/.test(body)
      ? parseCues(body, "vtt")
      : ext === ".srt" || /-->/.test(body)
        ? parseCues(body, "srt")
        : parseLines(body, o.durationSec);
  return finish(parsed);
}

/**
 * Words laid end to end from zero across `span` seconds, each taking a share of it by
 * its length. `spreadOverSpeech` then fits them to the sound; without sound, this is
 * where they stay.
 */
export function wordsAcross(text: string, span: number): Word[] {
  const tokens = text.split(/\s+/).filter(Boolean);
  const weights = tokens.map((token) => token.length + 1);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let at = 0;
  return tokens.map((w, i) => {
    const d = (span * weights[i]) / total;
    const word = { t: at, d, w };
    at += d;
    return word;
  });
}

/** Lines for words that arrived without any: at a pause, at a full stop, or before one runs too long. */
export function segmentsFromWords(words: Word[]): Segment[] {
  const out: Segment[] = [];
  let line: Word[] = [];
  const flush = () => {
    if (!line.length) return;
    const last = line[line.length - 1];
    out.push({ start: line[0].t, end: last.t + last.d, text: line.map((w) => w.w).join(" "), speaker: null });
    line = [];
  };
  for (const word of words) {
    const prev = line[line.length - 1];
    if (prev) {
      const gap = word.t - (prev.t + prev.d);
      const long = word.t + word.d - line[0].t > SEGMENT_MAX_SEC;
      const sentence = /[.!?…]["')\]»]?$/.test(prev.w) && prev.t + prev.d - line[0].t >= SEGMENT_MIN_SEC;
      if (gap > SEGMENT_GAP_SEC || long || sentence) flush();
    }
    line.push(word);
  }
  flush();
  return out;
}

// ─── subtitles ───────────────────────────────────────────────────────────────

const INLINE_CLOCK = /<((?:\d+:)?\d{2}:\d{2}[.,]\d{3})>/;

function plain(text: string): string {
  return text
    .replace(/<[^>]*>/g, "")
    .replace(/\{\\[^}]*\}/g, "")
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

type Cue = { start: number; end: number; lines: string[] };

function parseCues(body: string, format: "srt" | "vtt"): ParsedTranscript {
  const language = /^Language:\s*([\w-]+)/m.exec(body.split(/\n{2,}/)[0] ?? "")?.[1] ?? null;
  const cues: Cue[] = [];
  for (const block of body.split(/\n{2,}/)) {
    const lines = block.split("\n");
    const at = lines.findIndex((line) => line.includes("-->"));
    // The header, NOTE and STYLE blocks, and a number with nothing under it.
    if (at < 0) continue;
    const [from, rest = ""] = lines[at].split("-->");
    const start = parseClock(from);
    const end = parseClock(rest.trim().split(/\s+/)[0] ?? "");
    if (start === null || end === null) continue;
    cues.push({ start, end: Math.max(end, start), lines: lines.slice(at + 1).filter((line) => line.trim()) });
  }
  // YouTube's own captions time every word inline. Those lines are the words, and the
  // untimed lines around them are the previous line repeated as it scrolls up.
  if (cues.some((cue) => cue.lines.some((line) => INLINE_CLOCK.test(line)))) {
    return { format, language, segments: [], words: inlineWords(cues) };
  }

  const segments: Segment[] = [];
  for (const cue of cues) {
    const joined = cue.lines.join(" ");
    const speaker = /<v(?:\.[^\s>]+)*\s+([^>]+)>/.exec(joined)?.[1]?.trim() ?? null;
    const text = plain(joined);
    if (!text) continue;
    const prev = segments[segments.length - 1];
    // The same line carried across two cues is one line held on screen longer.
    if (prev && prev.text === text && cue.start - prev.end < 0.05) {
      prev.end = Math.max(prev.end, cue.end);
      continue;
    }
    segments.push({ start: cue.start, end: cue.end, text, speaker });
  }
  return { format, language, segments, words: [] };
}

function inlineWords(cues: Cue[]): Word[] {
  const chunks: Array<{ t: number; text: string; cueEnd: number }> = [];
  for (const cue of cues) {
    for (const line of cue.lines) {
      if (!INLINE_CLOCK.test(line)) continue;
      // [text before the first clock, clock, text, clock, text, ...]
      const pieces = line.split(new RegExp(INLINE_CLOCK.source));
      chunks.push({ t: cue.start, text: plain(pieces[0]), cueEnd: cue.end });
      for (let i = 1; i < pieces.length; i += 2) {
        const t = parseClock(pieces[i]);
        if (t !== null) chunks.push({ t, text: plain(pieces[i + 1] ?? ""), cueEnd: cue.end });
      }
    }
  }
  const timed = chunks.filter((chunk) => chunk.text);
  const words: Word[] = [];
  for (const [i, chunk] of timed.entries()) {
    const next = timed[i + 1];
    const end = Math.min(next ? next.t : chunk.cueEnd, chunk.t + WORD_MAX_SEC * chunk.text.split(" ").length);
    for (const word of wordsAcross(chunk.text, Math.max(0.01, end - chunk.t))) words.push({ ...word, t: chunk.t + word.t });
  }
  return words;
}

// ─── plain lines ─────────────────────────────────────────────────────────────

const CLOCK = String.raw`(?:\d+:)?\d{1,2}:\d{2}(?:[.,]\d+)?`;
const TIMED_LINE = new RegExp(String.raw`^\s*[\[(]?(${CLOCK})(?:\s*(?:-->|–|—|-|to)\s*(${CLOCK}))?[\])]?\s*[-–—:|]?\s*(.*)$`);

/**
 * `[01:23:45] what was said`, `1:23:45 - 1:23:50 what was said`, or a copied
 * transcript panel where the time sits alone on a line above its text.
 */
function parseLines(body: string, durationSec?: number): ParsedTranscript {
  const rows: Array<{ start: number; end: number | null; text: string }> = [];
  for (const line of body.split("\n")) {
    const match = TIMED_LINE.exec(line);
    const start = match ? parseClock(match[1]) : null;
    if (match && start !== null) {
      rows.push({ start, end: match[2] ? parseClock(match[2]) : null, text: match[3].trim() });
      continue;
    }
    // A line with no time belongs to the one above it; before the first time, it is a heading.
    const last = rows[rows.length - 1];
    if (last && line.trim()) last.text = `${last.text} ${line.trim()}`.trim();
  }
  if (!rows.length) {
    throw new Error("This transcript has no timestamps, so there is no way to know where its words are in the video. Add one in SRT, VTT or JSON, or with a time at the start of each line.");
  }
  const segments: Segment[] = rows.map((row, i) => {
    const next = rows[i + 1];
    const guess = row.start + Math.max(2, row.text.split(/\s+/).length * 0.45);
    const end = row.end ?? (next ? next.start : Math.min(guess, durationSec ?? guess));
    return { start: row.start, end: Math.max(end, row.start), text: row.text, speaker: null };
  });
  return { format: "lines", language: null, segments, words: [] };
}

// ─── JSON ────────────────────────────────────────────────────────────────────

type Entry = { start: number; end: number | null; text: string; speaker: string | null; p?: number };
type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
const firstString = (...values: unknown[]) => values.find((v): v is string => typeof v === "string");

function time(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !value.trim()) return null;
  return parseClock(value) ?? (Number.isFinite(Number(value)) ? Number(value) : null);
}
const firstTime = (...values: unknown[]) => {
  for (const value of values) {
    const t = time(value);
    if (t !== null) return t;
  }
  return null;
};

function entry(o: unknown): Entry | null {
  if (!isObject(o)) return null;
  const text = firstString(o.punctuated_word, o.text, o.word, o.w, o.content, o.transcript, o.caption)?.trim();
  const start = firstTime(o.start, o.startTime, o.start_time, o.from, o.t, o.offset, o.begin);
  if (!text || start === null) return null;
  const end = firstTime(o.end, o.endTime, o.end_time, o.to, o.stop);
  const duration = firstTime(o.d, o.duration, o.dur);
  const speakerValue = o.speaker ?? o.speaker_label ?? o.spk;
  const speaker = typeof speakerValue === "number" ? `Speaker ${speakerValue + 1}` : typeof speakerValue === "string" && speakerValue ? speakerValue : null;
  const confidence = [o.confidence, o.probability, o.p].find((v): v is number => typeof v === "number" && v >= 0 && v <= 1);
  return { start, end: end ?? (duration !== null ? start + duration : null), text, speaker, ...(confidence === undefined ? {} : { p: confidence }) };
}

const entries = (value: unknown): Entry[] => (Array.isArray(value) ? value.map(entry).filter((e): e is Entry => e !== null) : []);

/** Seconds per unit of the file's clock: 1, or 1/1000 for a file counting milliseconds. */
function unit(all: Entry[], durationSec?: number): number {
  const latest = Math.max(0, ...all.map((e) => e.end ?? e.start));
  if (durationSec && durationSec > 0) return latest > durationSec * 1.5 && latest / 1000 <= durationSec * 1.5 ? 1 / 1000 : 1;
  return latest > MS_THRESHOLD ? 1 / 1000 : 1;
}

function parseJson(body: string, durationSec?: number): ParsedTranscript {
  let data: unknown;
  try { data = JSON.parse(body); }
  catch (error) { throw new Error(`The transcript is not valid JSON: ${(error as Error).message}`); }

  // whisper.cpp's own `-oj` output: segments timed in milliseconds under `offsets`.
  if (isObject(data) && Array.isArray(data.transcription)) {
    const segments = data.transcription
      .filter(isObject)
      .map((seg) => {
        const offsets = isObject(seg.offsets) ? seg.offsets : {};
        return { start: Number(offsets.from ?? 0) / 1000, end: Number(offsets.to ?? 0) / 1000, text: plain(String(seg.text ?? "")), speaker: null };
      });
    const result = isObject(data.result) ? data.result : {};
    return { format: "whisper.cpp", language: firstString(result.language) ?? null, segments, words: [] };
  }

  const root: Json = isObject(data) ? data : { items: data };
  const results = isObject(root.results) ? root.results : {};
  const channel = Array.isArray(results.channels) && isObject(results.channels[0]) ? results.channels[0] : {};
  const alternative = Array.isArray(channel.alternatives) && isObject(channel.alternatives[0]) ? channel.alternatives[0] : {};
  const language = firstString(root.language, root.language_code, channel.detected_language) ?? null;
  // A known duration settles the clock's unit; AssemblyAI says its own in seconds.
  const duration = durationSec ?? (typeof root.audio_duration === "number" ? root.audio_duration : undefined);

  let words = [entries(root.words), entries(alternative.words)].find((list) => list.length) ?? [];
  let lines = [entries(root.segments), entries(root.utterances), entries(results.utterances), entries(root.cues), entries(root.captions)]
    .find((list) => list.length) ?? [];
  // A bare array is words when its entries are single words, lines otherwise.
  const bare = entries(root.items);
  if (bare.length) {
    const spaced = bare.filter((e) => /\s/.test(e.text)).length;
    if (spaced > bare.length / 2) lines = bare;
    else words = bare;
  }
  if (!words.length && !lines.length) {
    throw new Error("No timed words or lines were found in this JSON. Expected entries with a start time and text, such as {\"start\": 1.2, \"end\": 3.4, \"text\": \"…\"}.");
  }

  const scale = unit([...words, ...lines], duration);
  const toWords = (list: Entry[]): Word[] => list.map((e, i) => {
    const t = e.start * scale;
    const next = list[i + 1];
    const end = e.end !== null ? e.end * scale : Math.min(next ? next.start * scale : t + WORD_MAX_SEC, t + WORD_MAX_SEC);
    return { t, d: Math.max(0.01, end - t), w: e.text, ...(e.p === undefined ? {} : { p: e.p }) };
  });
  const toSegments = (list: Entry[]): Segment[] => list.map((e, i) => {
    const start = e.start * scale;
    const next = list[i + 1];
    const end = e.end !== null ? e.end * scale : next ? next.start * scale : start + Math.max(2, e.text.split(/\s+/).length * 0.45);
    return { start, end: Math.max(end, start), text: plain(e.text), speaker: e.speaker };
  });
  return { format: "json", language, segments: toSegments(lines), words: toWords(words) };
}

// ─── shared ──────────────────────────────────────────────────────────────────

/** In order, nothing empty, nothing ending before it starts; lines built from the words when the file had none. */
function finish(parsed: ParsedTranscript): ParsedTranscript {
  const words = parsed.words
    .filter((w) => w.w.trim() && Number.isFinite(w.t) && w.t >= 0)
    .map((w) => ({ ...w, w: w.w.trim(), d: Math.max(0.01, w.d) }))
    .sort((a, b) => a.t - b.t);
  const segments = parsed.segments
    .filter((s) => s.text.trim() && Number.isFinite(s.start) && s.start >= 0)
    .map((s) => ({ ...s, end: Math.max(s.end, s.start + 0.01) }))
    .sort((a, b) => a.start - b.start);
  if (!words.length && !segments.length) throw new Error("No timed text was found in this transcript.");
  return { ...parsed, words, segments: segments.length ? segments : segmentsFromWords(words) };
}
