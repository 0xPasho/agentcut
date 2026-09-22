import type { Word } from "../../transcription/lib/transcript";

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
};

/** A word the recogniser heard, not a gap between two of them. */
const EPS = 0.05;

export function tightenBoundaries(
  words: Word[],
  start: number,
  end: number,
  limits: BoundaryLimits,
): [number, number] {
  const { duration, fps = 30, peaks = [], leadSec = 0.25, tailSec = 0.35, maxDeadSec = 0.6 } = limits;
  // The last frame of a container is routinely undecodable; ending on it is a black frame.
  const ceiling = Math.max(0, duration - 1 / fps);

  let s = Math.max(0, Math.min(start, ceiling));
  let e = Math.min(Math.max(end, s), ceiling);

  // A boundary inside a word takes the whole word: half a word is never the intent.
  const straddlingStart = words.find((w) => w.t < s && w.t + w.d > s + EPS);
  if (straddlingStart) s = Math.max(0, straddlingStart.t);
  const straddlingEnd = words.find((w) => w.t < e - EPS && w.t + w.d > e);
  if (straddlingEnd) e = Math.min(ceiling, straddlingEnd.t + straddlingEnd.d);

  const spoken = words.filter((w) => w.t + w.d > s + EPS && w.t < e - EPS);
  // Nothing is said inside these boundaries: this is a reaction, a demo, a piece of
  // gameplay. There is no speech to trim to, so the agent's choice stands.
  if (!spoken.length) return [round(s), round(e)];

  const first = spoken[0];
  const last = spoken[spoken.length - 1];
  const lastEnd = Math.min(ceiling, last.t + last.d);

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
  if (e <= s) e = Math.min(ceiling, s + 0.5);
  return [round(s), round(e)];
}

const round = (n: number) => Number(n.toFixed(3));
