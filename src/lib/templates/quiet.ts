/**
 * Stretches a recording is silent in that the transcript claims somebody is talking over.
 *
 * Dead air is normally found in the transcript: the gap between one word ending and the
 * next beginning. That works until the recogniser is wrong about the clock. A real clip
 * from a real stream came out with four and a half seconds of room noise in the middle
 * of twenty-one, captioned the whole way — amplify that stretch by twenty decibels and
 * transcribe it again and it says nothing at all — because a speech model faced with a
 * long silence spreads the *next* phrase's word timings backwards across it. The words
 * are real; they are spoken four seconds later than the transcript places them.
 *
 * Which is why this reports rather than cuts. Cutting the silence would take the captions
 * for speech that is still in the video, and moving the words to where the sound is needs
 * a forced alignment, not a threshold. What a person can do with the reading — trim the
 * clip, choose another moment, fix the mic — they can only do if they are told.
 *
 * A run counts as dead when it sits far below the clip's own speech: not a little below,
 * which is how somebody trailing off sounds, but the thirteen decibels that separate a
 * voice from a room. Measured across eight clips of two streams, that finds the one clip
 * whose transcript is out and says nothing about the other seven.
 */

/** How far under a clip's own loud level a stretch has to sit before it counts as dead. */
export const DEAD_BELOW_DB = 13;
/** Below this much difference between floor and ceiling there is nothing to compare. */
const MIN_RANGE_DB = 6;
/** Shorter than this, a stretch of room noise under a word is a breath, not a problem. */
export const MIN_DEAD_SEC = 1.5;
/** And the words have to actually claim it: below this share it is an ordinary pause. */
export const CLAIMED_SHARE = 0.4;

export type Envelope = Array<{ t: number; db: number }>;
export type DeadRun = { t: number; d: number; claimed: number; words: string[] };

export function deadAir(
  envelope: Envelope,
  clip: { start: number; end: number; words: Array<{ t: number; d: number; w: string }> },
  stepSec: number,
): DeadRun[] {
  const inside = envelope.filter((point) => point.t >= clip.start && point.t <= clip.end);
  if (inside.length < 4) return [];
  const sorted = inside.map((point) => point.db).sort((a, b) => a - b);
  const floor = sorted[Math.floor(sorted.length * 0.1)];
  const speech = sorted[Math.floor(sorted.length * 0.9)];
  // A clip with no dynamics — a tone, a hold, pure silence — has no quiet to find in it.
  if (speech - floor < MIN_RANGE_DB) return [];
  const limit = speech - DEAD_BELOW_DB;

  const duration = clip.end - clip.start;
  const runs: DeadRun[] = [];
  let from: number | null = null;
  const close = (to: number) => {
    if (from === null) return;
    const [a, b] = [from, Math.min(to, duration)];
    from = null;
    if (b - a < MIN_DEAD_SEC) return;
    const over = clip.words.filter((word) => Math.min(word.t + word.d, b) - Math.max(word.t, a) > 0);
    const claimed = over.reduce((total, word) => total + Math.min(word.t + word.d, b) - Math.max(word.t, a), 0) / (b - a);
    if (claimed < CLAIMED_SHARE) return;
    runs.push({ t: a, d: b - a, claimed, words: over.map((word) => word.w) });
  };
  for (const point of inside) {
    const at = point.t - clip.start;
    if (point.db < limit) { if (from === null) from = at; }
    else close(at);
  }
  // A reading covers the step that follows it, so a run reaching the last one reaches the end.
  close(inside[inside.length - 1].t - clip.start + stepSec);
  return runs;
}
