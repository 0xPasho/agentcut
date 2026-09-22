import type { Word } from "../transcript";
import { silenceCuts } from "./script";
import type { TemplateRhythm } from "./schema";

/**
 * How fast a finished video reads.
 *
 * A template's dead-air settings decide the pace of every video made with it, and there
 * is no way to choose them by looking at a document. There is a way to choose them by
 * measuring: a video already cut the way you want has a distribution of pauses, and the
 * settings that reproduce that distribution on new material are the ones to write down.
 *
 * Measured this way, this channel's own published shorts keep a pause longer than a third
 * of a second roughly every three seconds — nineteen a minute — while the settings the
 * stream template shipped with left none at all. The first pass at "cut the dead air" cut
 * the breathing too.
 */
export type GapProfile = {
  /** Every gap between consecutive words, in seconds, shortest first. */
  gaps: number[];
  median: number;
  p75: number;
  p90: number;
  p95: number;
  /** Pauses over a third of a second, per minute of finished video. */
  perMinute: number;
  /** First word to last, in seconds. */
  spanSec: number;
};

/** A pause a viewer notices. Under this is the rhythm of speech rather than a pause. */
export const NOTICEABLE_PAUSE = 0.35;

const at = (sorted: number[], p: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : 0);

export function gapProfile(words: Word[]): GapProfile {
  const gaps: number[] = [];
  for (let i = 1; i < words.length; i++) {
    const gap = words[i].t - (words[i - 1].t + words[i - 1].d);
    if (gap > 0.001) gaps.push(gap);
  }
  gaps.sort((a, b) => a - b);
  const spanSec = words.length > 1 ? words[words.length - 1].t + words[words.length - 1].d - words[0].t : 0;
  return {
    gaps,
    median: at(gaps, 0.5),
    p75: at(gaps, 0.75),
    p90: at(gaps, 0.9),
    p95: at(gaps, 0.95),
    perMinute: spanSec > 0 ? gaps.filter((g) => g > NOTICEABLE_PAUSE).length / (spanSec / 60) : 0,
    spanSec,
  };
}

/** What `words` would read like once `silence` has been cut out of them. */
export function profileAfterCuts(words: Word[], silence: TemplateRhythm["silence"], clipDuration: number): GapProfile {
  const cuts = silenceCuts(words, silence, clipDuration);
  const shortened: Word[] = [];
  let shift = 0;
  let cutIndex = 0;
  for (const [index, word] of words.entries()) {
    while (cutIndex < cuts.length && cuts[cutIndex].t + cuts[cutIndex].d <= word.t + 0.001) {
      shift += cuts[cutIndex].d;
      cutIndex += 1;
    }
    shortened.push({ ...word, t: word.t - shift });
    void index;
  }
  return gapProfile(shortened);
}

export type PaceFit = { minGapSec: number; keepSec: number; profile: GapProfile; distance: number };

/**
 * The dead-air settings that make `material` read like `target`.
 *
 * A grid search, because the search space is two numbers with sensible ranges and the
 * measure is cheap — and because a closed form would be fitting a curve to a judgement.
 * The distance weights what a viewer feels: how often a pause survives, and how long the
 * longer ones are. The median is left out of it; it is the rhythm of the speaker rather
 * than a decision the settings make.
 */
export function fitSilence(target: GapProfile, material: Array<{ words: Word[]; durationSec: number }>): PaceFit {
  let best: PaceFit | null = null;
  for (let minGapSec = 0.4; minGapSec <= 2.001; minGapSec += 0.1) {
    for (let keepSec = 0.1; keepSec <= 0.5001; keepSec += 0.05) {
      const silence = { enabled: true, minGapSec: Math.round(minGapSec * 100) / 100, keepSec: Math.round(keepSec * 100) / 100, maxGapSec: 30 };
      const gaps: number[] = [];
      let span = 0;
      for (const piece of material) {
        const profile = profileAfterCuts(piece.words, silence, piece.durationSec);
        gaps.push(...profile.gaps);
        span += profile.spanSec;
      }
      gaps.sort((a, b) => a - b);
      const profile: GapProfile = {
        gaps,
        median: at(gaps, 0.5), p75: at(gaps, 0.75), p90: at(gaps, 0.9), p95: at(gaps, 0.95),
        perMinute: span > 0 ? gaps.filter((g) => g > NOTICEABLE_PAUSE).length / (span / 60) : 0,
        spanSec: span,
      };
      const distance =
        Math.abs(profile.perMinute - target.perMinute) / 10 +
        Math.abs(profile.p75 - target.p75) * 2 +
        Math.abs(profile.p90 - target.p90) +
        Math.abs(profile.p95 - target.p95) * 0.5;
      if (!best || distance < best.distance) best = { minGapSec: silence.minGapSec, keepSec: silence.keepSec, profile, distance };
    }
  }
  return best!;
}
