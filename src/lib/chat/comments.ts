import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { db } from "../db";
import type { Word } from "../transcript";

/**
 * The stream's chat, on the video's clock.
 *
 * A stream short usually answers somebody: a viewer asks, the streamer reads it out and
 * answers, and the clip is the answer. Opening on the question is what makes the answer
 * make sense, so the comment is shown first and the video follows it.
 *
 * The chat is not guessed at. The unified chat (TikTok, Twitch, YouTube and Kick in one
 * feed) already stores every message in SQLite with its platform, author and the moment
 * it arrived, and a stream recording says when it went live. The two clocks together put
 * every message at a second of the video; what remains is choosing which one a clip is
 * answering, and that is decided by what the streamer says — deterministically, from the
 * transcript, with no model in the loop.
 */

export type ChatPlatform = "tiktok" | "twitch" | "youtube" | "kick";

export type ChatComment = {
  /** The chat database's own row id. Stable, so a choice can be named and repeated. */
  id: number;
  platform: ChatPlatform;
  /** Epoch ms the message arrived. */
  ts: number;
  name: string;
  handle: string;
  avatar: string;
  /** The author's own colour where the platform sends one (Twitch). */
  color: string;
  text: string;
};

export type RankedComment = ChatComment & {
  /** Seconds of the source when it arrived. */
  atSec: number;
  /** 0..1: how much of the comment the streamer is heard saying. */
  score: number;
  /** The comment's words the clip says. */
  matched: string[];
};

const SETTING = "chat.dbPath";
/** Where the unified chat keeps its database when it is cloned into the home folder. */
const DEFAULT_DB = path.join(os.homedir(), "restream-tiktok-chat", "data", "chat.db");

db.exec(`CREATE TABLE IF NOT EXISTS settings (scope TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (scope, key))`);

/** The configured path, if any, and where the one in use came from. */
export function chatSource(): { path: string | null; from: "setting" | "env" | "default" | "none"; configured: string } {
  const row = db.prepare("SELECT value FROM settings WHERE scope = 'workspace' AND key = ?").get(SETTING) as { value: string } | undefined;
  const configured = row?.value ?? "";
  if (configured) return { path: configured, from: "setting", configured };
  if (process.env.CHAT_DB_PATH) return { path: process.env.CHAT_DB_PATH, from: "env", configured };
  if (fs.existsSync(DEFAULT_DB)) return { path: DEFAULT_DB, from: "default", configured };
  return { path: null, from: "none", configured };
}

/** Save the chat database's path for the whole workspace; an empty string clears it. */
export function saveChatSource(file: string) {
  const value = file.trim();
  if (!value) { db.prepare("DELETE FROM settings WHERE scope = 'workspace' AND key = ?").run(SETTING); return chatSource(); }
  if (!fs.existsSync(value)) throw new Error(`No chat database at ${value}.`);
  readComments(value, 0, 1);
  db.prepare("INSERT INTO settings (scope, key, value) VALUES ('workspace', ?, ?) ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value").run(SETTING, value);
  return chatSource();
}

/**
 * Messages that arrived between two moments, oldest first. Read-only, and never locking:
 * the chat keeps writing to this file while a stream is live.
 */
export function readComments(file: string, fromMs: number, toMs: number): ChatComment[] {
  const chat = new DatabaseSync(file, { readOnly: true });
  try {
    const rows = chat.prepare(
      `SELECT id, platform, ts, nickname, handle, avatar, color, text FROM events
       WHERE type = 'chat' AND is_bot = 0 AND text IS NOT NULL AND ts >= ? AND ts <= ?
       ORDER BY ts ASC LIMIT 2000`,
    ).all(fromMs, toMs) as Array<Record<string, string | number | null>>;
    return rows.map((row) => ({
      id: Number(row.id),
      platform: String(row.platform) as ChatPlatform,
      ts: Number(row.ts),
      name: String(row.nickname || row.handle || "anónimo"),
      handle: String(row.handle ?? ""),
      avatar: String(row.avatar ?? ""),
      color: String(row.color ?? ""),
      text: String(row.text ?? "").trim(),
    })).filter((row) => row.text);
  } finally {
    chat.close();
  }
}

export function commentById(file: string, id: number): ChatComment | null {
  const chat = new DatabaseSync(file, { readOnly: true });
  try {
    const row = chat.prepare("SELECT ts FROM events WHERE id = ? AND type = 'chat'").get(id) as { ts: number } | undefined;
    if (!row) return null;
    return readComments(file, row.ts, row.ts).find((comment) => comment.id === id) ?? null;
  } finally {
    chat.close();
  }
}

const fold = (word: string) => word.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\p{L}\p{N}]/gu, "");

/**
 * Words too common to say anything about which comment a clip answers. Spanish first —
 * the channel's language — and the English that a coding stream is full of.
 */
const STOP = new Set((
  "que los las del una uno unos unas por para con como mas pero sus son esta este esto estas estos eso esa ese " +
  "hay muy sin sobre entre cuando donde quien cual tambien porque todo toda todos todas nos les lo le la el en " +
  "ya asi solo algo tiene tienes tengo hace hacer puede puedes pues bueno entonces osea igual aqui alla ahi " +
  "fue era ser estar estas estoy esta estan haber has han hemos yo tu ella ellos usted ustedes mi mis tus " +
  "que tal hola buenas buenos dias noches tardes saludos pasho gracias jaja jajaja xd " +
  "the and for you are was with this that have not but what how can your from they will just like"
).split(/\s+/));

export const contentWords = (text: string) =>
  [...new Set(text.split(/\s+/).map(fold).filter((word) => word.length >= 3 && !STOP.has(word)))];

/** How far before a clip starts a comment may have arrived and still be what it answers. */
export const LOOKBACK_SEC = 240;
/** How far into a clip it may arrive: the streamer can start answering as it lands. */
export const LOOKAHEAD_SEC = 20;
/** The share of a comment's words the clip must say before it counts as the question. */
export const MIN_SCORE = 0.5;

/**
 * The comments a clip could be answering, best first.
 *
 * `words` are the clip's, in seconds of the clip; `clipStart` is where the clip sits in
 * the source and `recordedAt` when the source began. A comment ranks by the share of
 * its words the streamer says in the first half-minute of the clip — reading a question
 * out is what answering it on a stream sounds like — and a comment nobody says anything
 * from is not a candidate at all, however close in time.
 */
export function rankComments(
  comments: ChatComment[],
  clip: { start: number; words: Word[] },
  recordedAt: number,
  options: { lookbackSec?: number; listenSec?: number } = {},
): RankedComment[] {
  const listen = options.listenSec ?? 30;
  const spoken = new Set(clip.words.filter((word) => word.t <= listen).flatMap((word) => contentWords(word.w)));
  const ranked: RankedComment[] = [];
  for (const comment of comments) {
    const atSec = (comment.ts - recordedAt) / 1000;
    const words = contentWords(comment.text);
    if (!words.length) continue;
    const matched = words.filter((word) => spoken.has(word));
    const score = matched.length / words.length;
    ranked.push({ ...comment, atSec, score, matched });
  }
  // Better match first; between equals, the one that arrived closest to the answer.
  return ranked.sort((a, b) => Number(answers(b)) - Number(answers(a)) || b.score - a.score || b.matched.length - a.matched.length || b.ts - a.ts);
}

/** Read out, this many of a comment's words are the question even when it said much more. */
export const READ_OUT_WORDS = 4;

/**
 * Whether a ranked comment is clearly the one the clip answers, rather than a coincidence
 * of words. Most of it said back, or — for a long comment the streamer only reads the end
 * of — four of its words, which with the filler taken out is not an accident.
 */
export const answers = (comment: RankedComment) =>
  comment.matched.length >= READ_OUT_WORDS ||
  (comment.score >= MIN_SCORE && (comment.matched.length >= 2 || (comment.matched.length === 1 && contentWords(comment.text).length === 1 && comment.matched[0].length >= 5)));

/** The window of chat a clip could be answering, in epoch ms. */
export function chatWindow(clip: { start: number; end: number }, recordedAt: number, lookbackSec = LOOKBACK_SEC) {
  return {
    from: recordedAt + Math.max(0, clip.start - lookbackSec) * 1000,
    to: recordedAt + Math.min(clip.end, clip.start + LOOKAHEAD_SEC) * 1000,
  };
}
