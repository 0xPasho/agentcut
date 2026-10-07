import type { Word } from "../../transcription/lib/transcript";

/** A stretch of the source's audio loud enough to be speech, in seconds. */
export type SpeechSpan = { start: number; end: number };

/**
 * Where a clip actually starts and ends, once the words are consulted.
 *
 * An agent picks boundaries by reading a transcript, and a transcript does not show
 * dead air: it says a line starts at 14:02 and says nothing about the twelve seconds
 * of room tone before it. Left alone those seconds are the opening of the short, which
 * is the one place a viewer decides to leave. The same blindness at the other end
 * lands the cut a few hundred milliseconds inside the final word.
 *
 * So the boundaries are settled here, deterministically, from the word timestamps —
 * not asked for again from the model, which would be another round trip and another
 * chance to be wrong.
 */
export type BoundaryLimits = {
  /** Source duration, seconds. Nothing is allowed past it. */
  duration: number;
  /** Source frame rate, so the clip can stop short of a last frame that may not decode. */
  fps?: number;
  /** Loudness peaks in source seconds — laughter, applause, a reaction. Never cut away from one. */
  peaks?: number[];
  /** Silence kept before the first word, so the clip does not open on a syllable already underway. */
  leadSec?: number;
  /** Silence kept after the last word, so the final word is not clipped. */
  tailSec?: number;
  /** Dead air tolerated at either end before it is worth tightening. */
  maxDeadSec?: number;
  /**
   * Where the sound says somebody is speaking, in order. The recogniser guesses where a
   * word ends; the audio knows. With these the first word starts no later than its sound
   * does and the last one is not cut before its sound stops.
   */
  speech?: SpeechSpan[];
  /**
   * Seconds of the clip to keep before the first word when something happens there — a
   * viewer's comment popping in over the hook before it is read out. Taken from the
   * silence before the word, never from the word said before it.
   */
  openingSec?: number;
};

/** Past the recogniser's own end, the sound may carry a word this much further before it is a different phrase. */
const SOUND_REACH_SEC = 0.6;
/** Kept after the sound of the last word stops, so the decay is heard rather than chopped. */
const SOUND_TAIL_SEC = 0.08;

/** A word the recogniser heard, not a gap between two of them. */
const EPS = 0.05;

export function tightenBoundaries(
  words: Word[],
  start: number,
  end: number,
  limits: BoundaryLimits,
): [number, number] {
  const { duration, fps = 30, peaks = [], tailSec = 0.35, speech = [], openingSec = 0 } = limits;
  // An opening needs its silence: neither trimmed away as dead air nor cut short of it.
  const leadSec = Math.max(limits.leadSec ?? 0.25, openingSec);
  const maxDeadSec = Math.max(limits.maxDeadSec ?? 0.6, openingSec + 0.1);
  // The last frame of a container is routinely undecodable; ending on it is a black frame.
  const ceiling = Math.max(0, duration - 1 / fps);

  let s = Math.max(0, Math.min(start, ceiling));
  let e = Math.min(Math.max(end, s), ceiling);

  // A boundary inside a word takes the whole word: half a word is never the intent.
  const straddlingStart = words.find((w) => w.t < s && w.t + w.d > s + EPS);
  if (straddlingStart) s = Math.max(0, straddlingStart.t);
  const straddlingEnd = words.find((w) => w.t < e - EPS && w.t + w.d > e);
  if (straddlingEnd) e = Math.min(ceiling, straddlingEnd.t + straddlingEnd.d);

  let spoken = words.filter((w) => w.t + w.d > s + EPS && w.t < e - EPS);
  // Nothing is said inside these boundaries: this is a reaction, a demo, a piece of
  // gameplay. There is no speech to trim to, so the agent's choice stands.
  if (!spoken.length) return [round(s), round(e)];

  // The tail of a sentence begun before the clip is the end of another answer: "…está
  // difícil | sin el certificado." opened a clip about starting a project. With a full
  // stop to go by, the clip opens on the sentence after it instead.
  const borrowed = sentenceTail(words, spoken);
  if (borrowed > 0) {
    const opener = spoken[borrowed];
    const said = spoken[borrowed - 1];
    s = Math.max(opener.t - leadSec, said.t + Math.min(said.d, LONGEST_WORD_SEC) + 0.05, 0);
    spoken = spoken.slice(borrowed);
  }

  const first = spoken[0];
  // And the other end: a clip that stops a few words short of a full stop stops before
  // the point lands ("…la referencia para que te | construya cosas buenas."). It runs on
  // to the full stop.
  const unfinished = sentenceRest(words, spoken[spoken.length - 1]);
  if (unfinished.length) {
    spoken = [...spoken, ...unfinished];
    const closing = unfinished[unfinished.length - 1];
    e = Math.min(ceiling, Math.max(e, closing.t + Math.min(closing.d, LONGEST_WORD_SEC)));
  }

  const last = spoken[spoken.length - 1];
  const lastEnd = Math.min(ceiling, last.t + Math.min(last.d, LONGEST_WORD_SEC));

  // Dead air at the head. A peak inside it is a reaction worth opening on, so the
  // clip starts just before the earliest one instead of at the first word.
  if (first.t - s > maxDeadSec) {
    const audible = peaks.find((p) => p > s + EPS && p < first.t - leadSec);
    s = audible === undefined ? first.t - leadSec : Math.max(s, audible - 0.35);
  }

  // Dead air at the tail, with the same exception: laughter after the punchline is
  // the payoff, not silence to remove.
  if (e - lastEnd > maxDeadSec) {
    const reactions = peaks.filter((p) => p > lastEnd + EPS && p < e);
    const until = reactions.length ? Math.max(...reactions) + 0.6 : lastEnd + tailSec;
    e = Math.min(e, Math.max(lastEnd + tailSec, until));
  }

  // The recogniser routinely ends a word slightly early, so a boundary on its reported
  // end clips the consonant off it. Give it room — but never so much that the next word
  // starts inside the clip and is cut off in turn.
  const next = words.find((w) => w.t >= lastEnd - EPS);
  const room = next ? Math.max(lastEnd, next.t - 0.05) : ceiling;
  e = Math.min(Math.max(e, lastEnd + Math.min(tailSec, 0.12)), room, ceiling);

  s = Math.max(0, Math.min(s, first.t));

  // The sound has the last word. "rápido" reported as ending at 2033.40 was still
  // sounding at 2033.76, and a cut on the reported end kept "rapi". The speech run the
  // last word is in carries the end to where the sound stops — not into the next word,
  // and not further than a word can plausibly run on.
  const tail = speech.find((run) => run.start <= lastEnd + EPS && run.end >= last.t);
  if (tail && tail.end > lastEnd && tail.end <= lastEnd + SOUND_REACH_SEC)
    e = Math.min(Math.max(e, tail.end + SOUND_TAIL_SEC), room, ceiling);
  // And the first: a word the recogniser starts late opens on half a syllable.
  const previous = [...words].reverse().find((w) => w.t + w.d <= first.t - EPS);
  const head = speech.find((run) => run.start <= first.t + EPS && run.end >= first.t);
  if (head && head.start < s && head.start >= first.t - SOUND_REACH_SEC && (!previous || head.start > previous.t + previous.d))
    s = Math.max(0, head.start - 0.03);

  // Room for the opening, reached back into the silence before the first word — never
  // into the word before it, which would open on the end of another sentence.
  if (openingSec > 0) {
    const before = [...words].reverse().find((w) => w.t + w.d <= first.t - EPS);
    s = Math.min(s, Math.max(0, first.t - openingSec, before ? before.t + before.d + 0.1 : 0));
  }

  if (e <= s) e = Math.min(ceiling, s + 0.5);
  return [round(s), round(e)];
}

const round = (n: number) => Number(n.toFixed(3));

/** Ends a sentence. A transcript without punctuation never matches, and nothing moves. */
const SENTENCE_END = /[.!?…]["»”)]*$/;
/** The longest tail of someone else's sentence worth dropping; past it, it is the clip's own. */
const MAX_TAIL_WORDS = 6;
/** A pause this long before the first word makes it a new phrase, punctuation or not. */
const NEW_PHRASE_SEC = 1;
/** Longer than any word is said: past it, a word's duration is a pause the aligner gave it. */
const LONGEST_WORD_SEC = 1.5;

/**
 * The words after `last` that finish its sentence, or none: only up to a full stop a few
 * words away with no pause on the way, and never when `last` already ends one.
 */
function sentenceRest(words: Word[], last: Word): Word[] {
  if (SENTENCE_END.test(last.w)) return [];
  const after = words.filter((w) => w.t > last.t + EPS).slice(0, MAX_TAIL_WORDS);
  const rest: Word[] = [];
  let previous = last;
  for (const word of after) {
    if (word.t - (previous.t + Math.min(previous.d, LONGEST_WORD_SEC)) > NEW_PHRASE_SEC) return [];
    rest.push(word);
    if (SENTENCE_END.test(word.w)) return rest;
    previous = word;
  }
  return [];
}

/**
 * How many words at the head of `spoken` finish a sentence that began before it, or 0.
 * Only when the clip goes on to a sentence of its own after them.
 */
function sentenceTail(words: Word[], spoken: Word[]): number {
  const first = spoken[0];
  const before = [...words].reverse().find((w) => w.t < first.t - EPS);
  if (!before || SENTENCE_END.test(before.w)) return 0;
  if (first.t - (before.t + Math.min(before.d, LONGEST_WORD_SEC)) > NEW_PHRASE_SEC) return 0;
  const close = spoken.findIndex((w) => SENTENCE_END.test(w.w));
  if (close < 0 || close >= MAX_TAIL_WORDS || close >= spoken.length - 1) return 0;
  return close + 1;
}
