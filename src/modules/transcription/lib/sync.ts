import type { Word } from "./transcript";

/**
 * Are the captions on the words?
 *
 * The renderer lights each word at the moment the transcript says it is spoken, so a
 * caption that reads late is a transcript that is late, and nothing in the editor can
 * show that: the words look right, they are simply on the wrong frames. What does show
 * it is the audio itself. Mark every window that is loud enough to be speech, mark every
 * window a word claims, and slide one against the other: the shift that agrees best is
 * how far the captions are out.
 *
 * A shift inside one frame is not a problem. `captions.syncOffsetMs` is the field that
 * fixes a real one, and this is how you know what to put in it.
 */

/** Which windows of an envelope are speech, by a threshold between its own floor and ceiling. */
export function speechMask(db: number[], fraction = 0.45): number[] {
  if (!db.length) return [];
  const sorted = [...db].sort((a, b) => a - b);
  const floor = sorted[Math.floor(sorted.length * 0.1)];
  const ceiling = sorted[Math.floor(sorted.length * 0.9)];
  // A span of pure silence has no ceiling to speak of; calling none of it speech is right.
  const threshold = ceiling - floor < 3 ? Infinity : floor + (ceiling - floor) * fraction;
  return db.map((value) => (value > threshold ? 1 : 0));
}

export type SyncReading = {
  /**
   * Seconds every word would have to move to agree best with the sound: positive when
   * the transcript runs early and the captions should come later, which is the sign
   * `captions.syncOffsetMs` takes.
   */
  shiftSec: number;
  /** How much of the span the two agree on at that shift, 0..1. */
  agreement: number;
  /** The same, with the words exactly where they are. */
  unshifted: number;
  /** Share of the span the sound calls speech, and the share the words claim. */
  speechShare: number;
  wordShare: number;
};

/**
 * The shift that lines a transcript up with the sound under it. `mask` is one entry per
 * `step` seconds from the start of the same span the words are relative to.
 */
export function readSync(words: Word[], mask: number[], step: number, maxShiftSec = 0.5): SyncReading {
  const frames = Math.max(1, Math.round(maxShiftSec / step));
  const spans = words.map((word) => [word.t, word.t + word.d] as const).sort((a, b) => a[0] - b[0]);
  const says = (t: number) => {
    // The spans are in order, so a binary search would be faster; a clip is a few hundred
    // words and this runs once, so the plain scan is the one that stays readable.
    for (const [from, to] of spans) {
      if (t < from) return false;
      if (t <= to) return true;
    }
    return false;
  };
  const score = (shift: number) => {
    let agreed = 0;
    for (const [index, value] of mask.entries()) if ((says(index * step + shift) ? 1 : 0) === value) agreed += 1;
    return agreed / (mask.length || 1);
  };
  let best = { shiftSec: 0, agreement: -1 };
  for (let frame = -frames; frame <= frames; frame++) {
    // `score` reads the words at a time offset from the sound, so the offset that fits
    // is the opposite of the move the words need: reading them earlier means they are
    // late, and moving them later is the fix.
    const shiftSec = frame === 0 ? 0 : -frame * step;
    const agreement = score(frame * step);
    // Ties go to the smaller shift: an offset nobody can see is not an offset.
    if (agreement > best.agreement || (agreement === best.agreement && Math.abs(shiftSec) < Math.abs(best.shiftSec)))
      best = { shiftSec, agreement };
  }
  const span = mask.length * step;
  return {
    ...best,
    unshifted: score(0),
    speechShare: mask.length ? mask.filter(Boolean).length / mask.length : 0,
    wordShare: span > 0 ? words.reduce((total, word) => total + word.d, 0) / span : 0,
  };
}
