import { DEFAULT_ITEM_TRANSFORM, type Ease, type ItemTransform, type SequenceItem, type TransformKeyframe } from "./edl";
import { buildTimeMap, clipFrames } from "./timeline";

/**
 * A layer's transform over the item's own time.
 *
 * This is the other half of `src/lib/edl.ts`'s `TransformKeyframe`: the schema says what a
 * sampled moment is, and this says what the frames between two of them look like. One
 * resolver, three consumers — the timeline, the Remotion Player and the export all call
 * `animatedAt`, so an animation that looks right in the preview is the animation that is
 * written to the file.
 *
 * It is deliberately shaped like `cropAt` next door in `remotion/ClipComposition.tsx`:
 * find the pair of keyframes the moment falls between, travel from one to the other. What
 * is added is that the travel can be curved, and that each field is looked up on its own —
 * a title that only fades says `opacity` and nothing else, and its size stays wherever the
 * static `transform` put it.
 */

/** Everything a keyframe may animate. Every other placement field is static by construction. */
export const ANIMATED_FIELDS = ["x", "y", "width", "height", "rotation", "opacity", "volume"] as const;
export type AnimatedField = (typeof ANIMATED_FIELDS)[number];

/** What a person is shown when an animated field has to be named. */
export const FIELD_LABELS: Record<AnimatedField, string> = {
  x: "position across", y: "position down", width: "width", height: "height",
  rotation: "rotation", opacity: "opacity", volume: "volume",
};

/** A layer's placement at one moment: its transform, and the gain multiplying everything it sounds. */
export type AnimatedState = ItemTransform & { volume: number };

/**
 * The five named curves, as functions of progress from one keyframe to the next.
 *
 * Quadratic rather than cubic or a bezier: a pack is data and may never ship code, so the
 * only curves that exist are the ones spelled in `Ease`, and the one already in this editor
 * — the punch-in's `Easing.inOut(Easing.quad)` — is the shape a person here has already
 * agreed reads as "arriving" rather than "jumping". `ease` matches it exactly.
 *
 * `hold` returns zero for every progress, so the value stays on the earlier keyframe and
 * changes on the frame the next one starts: a step, not a travel.
 */
export const EASES: Record<Ease, (progress: number) => number> = {
  linear: (p) => p,
  ease: (p) => (p < 0.5 ? 2 * p * p : 1 - 2 * (1 - p) * (1 - p)),
  in: (p) => p * p,
  out: (p) => 1 - (1 - p) * (1 - p),
  hold: () => 0,
};

/** The fields this item's keyframes decide. Everything else keeps the static transform. */
export function animatedFields(keyframes: TransformKeyframe[] | undefined): Set<AnimatedField> {
  const named = new Set<AnimatedField>();
  for (const key of keyframes ?? []) for (const field of ANIMATED_FIELDS) if (key[field] !== undefined) named.add(field);
  return named;
}

/** What the layer is with no keyframes at all, and what every un-animated field keeps. */
export const staticState = (item: Pick<SequenceItem, "transform" | "volume">): AnimatedState =>
  ({ ...DEFAULT_ITEM_TRANSFORM, ...item.transform, volume: item.volume ?? 1 });

/** How long the item runs on the programme, in its own output seconds, after its silence cuts. */
export const itemSeconds = (item: Pick<SequenceItem, "clip">, fps: number) =>
  clipFrames(buildTimeMap(item.clip), fps) / fps;

/**
 * One field's value `t` seconds into the item's own time.
 *
 * Outside the keyframes it holds: before the first and after the last, the value is that
 * keyframe's, which is what makes a single keyframe a constant for the whole item and what
 * lets a trim leave keyframes hanging off either end without anything jumping. `cropAt`
 * does exactly this, for exactly this reason.
 */
export function fieldAt(keyframes: TransformKeyframe[], field: AnimatedField, t: number, fallback: number): number {
  let previous: TransformKeyframe | null = null;
  for (const key of keyframes) {
    if (key[field] === undefined) continue;
    if (key.t > t) {
      if (!previous) return key[field]!;
      const span = key.t - previous.t;
      const progress = span <= 0 ? 1 : EASES[previous.ease](Math.max(0, Math.min(1, (t - previous.t) / span)));
      return previous[field]! + (key[field]! - previous[field]!) * progress;
    }
    previous = key;
  }
  return previous ? previous[field]! : fallback;
}

/**
 * The layer's transform and gain `t` seconds into its own time.
 *
 * `t` is measured from the item's first frame on the programme — which, for a shot that
 * arrives on a transition, is the first frame of the overlap. A move therefore begins as
 * the shot begins to appear, rather than waiting for the blend to finish: the two are one
 * arrival, and the alternative would leave an animation that could not be seen.
 */
export function animatedAt(item: SequenceItem, t: number): AnimatedState {
  const base = staticState(item);
  const keys = item.keyframes;
  if (!keys?.length) return base;
  const out = { ...base };
  for (const field of ANIMATED_FIELDS) out[field] = fieldAt(keys, field, t, base[field]);
  return out;
}

/** Six decimal places: enough for a percentage of a frame, few enough that a trim is stable. */
export const roundTime = (value: number) => Math.round(value * 1e6) / 1e6;

/**
 * The keyframes each half of a split keeps.
 *
 * Both halves gain a keyframe on the seam holding exactly the value the animation had
 * reached there. That is the same repair `trim` already makes to crop keyframes when it
 * interpolates a new one at the clip's new start, and it is what stops a cut from making
 * the layer jump: a split is a structural edit and must not be a creative one.
 *
 * With `linear` or `hold` either side, the two halves are the original frame for frame.
 * With a curve they are not, and this is the honest limit of a named catalogue: there is
 * no member of `Ease` that means "the first 40% of an ease", so each half re-eases the
 * travel it still has and the middle of each half lands somewhere slightly different.
 * Sampling the curve into a polyline would be exact and would throw away the author's
 * curve, which is worse — the value at the seam is the property worth being exact about.
 * The seam keyframe carries the ease and the authorship of the keyframe it was cut out of.
 */
export function splitKeyframes(keyframes: TransformKeyframe[] | undefined, at: number): {
  first: TransformKeyframe[] | undefined; second: TransformKeyframe[] | undefined;
} {
  if (!keyframes?.length) return { first: undefined, second: undefined };
  const fields = ANIMATED_FIELDS.filter((field) => keyframes.some((key) => key[field] !== undefined));
  const source = [...keyframes].reverse().find((key) => key.t <= at) ?? keyframes[0];
  const seam = (t: number): TransformKeyframe => ({
    ...Object.fromEntries(fields.map((field) => [field, roundTime(fieldAt(keyframes, field, at, 0))])),
    t, ease: source.ease, by: source.by,
  });
  return {
    first: [...keyframes.filter((key) => key.t < at), seam(at)],
    second: [seam(0), ...keyframes.filter((key) => key.t > at).map((key) => ({ ...key, t: roundTime(key.t - at) }))],
  };
}
