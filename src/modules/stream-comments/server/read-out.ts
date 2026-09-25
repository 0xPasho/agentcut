import type { Word } from "../../transcription/lib/transcript";
import { answers, chatSource, rankComments, readComments, readingSpan, type ChatComment } from "./comments";

/**
 * The stream's chat laid on the video's clock, for the agent choosing clips.
 *
 * The selection agent reads the transcript, and a transcript does not say that "¿pagas
 * Claude? dice Willman" is the streamer reading a viewer out — the moment a stream short
 * is made of. So before it chooses, every message is matched against what is said after
 * it arrived, the way a template matches the one a clip opens on, and the messages that
 * were read out are handed over with the second they were read.
 */

export type ReadOut = ChatComment & { sentSec: number; readSec: number | null };

/** How long after a message arrives the streamer may still get to it. */
const REACH_SEC = 180;
/** The stretch of speech one reading is looked for in, stepped across the reach. */
const WINDOW_SEC = 30;
const STEP_SEC = 3;
/** Messages that may arrive before the recording starts and still be read on it. */
const BEFORE_SEC = 300;

/** First index of a word at or after `t`, over words in order. */
function from(words: Word[], t: number): number {
  let lo = 0, hi = words.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (words[mid].t < t) lo = mid + 1; else hi = mid;
  }
  return lo;
}

/** Every chat message around the recording, and where the streamer reads it out, if they do. */
export function readOuts(recordedAt: number, durationSec: number, words: Word[]): ReadOut[] {
  const source = chatSource().path;
  if (!source) return [];
  const comments = readComments(source, recordedAt - BEFORE_SEC * 1000, recordedAt + durationSec * 1000);
  return comments.map((comment) => {
    const sentSec = (comment.ts - recordedAt) / 1000;
    for (let start = Math.max(0, sentSec - 2); start < sentSec + REACH_SEC && start < durationSec; start += STEP_SEC) {
      const window = words.slice(from(words, start), from(words, start + WINDOW_SEC)).map((w) => ({ ...w, t: w.t - start }));
      const [ranked] = rankComments([comment], { start, words: window }, recordedAt, { listenSec: WINDOW_SEC });
      if (!ranked || !answers(ranked)) continue;
      const span = readingSpan(window, comment.text, WINDOW_SEC);
      return { ...comment, sentSec, readSec: span ? start + span.t : start };
    }
    return { ...comment, sentSec, readSec: null };
  });
}

const clock = (sec: number) => `${Math.round(sec * 10) / 10}s`;

/** The chat as the agent reads it: what was read out first, then the rest. */
export function chatText(chat: ReadOut[]): string {
  const read = chat.filter((c) => c.readSec !== null).sort((a, b) => a.readSec! - b.readSec!);
  const rest = chat.filter((c) => c.readSec === null);
  const line = (c: ReadOut) => `${c.platform} · ${c.name}: ${c.text.replace(/\s+/g, " ").slice(0, 240)}`;
  return [
    `# Read out loud on stream (${read.length})`,
    ...read.map((c) => `- read at ${clock(c.readSec!)} (sent ${clock(c.sentSec)}) · id ${c.id} · ${line(c)}`),
    "",
    `# The rest of the chat (${rest.length}), not read out`,
    ...rest.map((c) => `- sent ${clock(c.sentSec)} · ${line(c)}`),
  ].join("\n");
}
