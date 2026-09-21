import type { SequenceItem, TransformKeyframe } from "../edl";
import { ANIMATED_FIELDS, FIELD_LABELS, animatedFields, fieldAt, staticState, type AnimatedField } from "../keyframes";

/**
 * Editing a layer's motion, as operations on one list of keyframes.
 *
 * Everything here is pure and returns the list the `item.keyframes` operation takes, so
 * the panel, a drag on the canvas, a keyboard nudge and a test all produce the same edit —
 * and an agent writing the same list by hand lands in exactly the same place. There is no
 * behaviour in here that the agent cannot reach; the buttons are shortcuts to a list, not
 * a second way of animating.
 */

/** The placement fields a move is made of. Volume is animated on its own, being sound. */
export const PLACEMENT_FIELDS = ["x", "y", "width", "height", "rotation", "opacity"] as const;

/** Close enough to be the same moment: half a frame at 60fps, so a drag lands on one keyframe. */
const SAME_MOMENT = 0.008;

const round = (value: number) => Math.round(value * 1000) / 1000;
/**
 * A moment a person authored, to the millisecond.
 *
 * Frame-exact would be `frame / fps`, which at 30fps is 2.4666666… — a number this panel
 * would then have to show them. A thousandth of a second is a thirtieth of a frame, and
 * the value is interpolated continuously rather than sampled on a grid, so rounding it
 * costs nothing anybody can see and buys a time a person can read and retype.
 */
const roundMoment = (value: number) => Math.round(value * 1000) / 1000;

/** What each keyframe says, for a list a person reads. */
export const keyframeSummary = (key: TransformKeyframe) =>
  ANIMATED_FIELDS.filter((field) => key[field] !== undefined).map((field) => FIELD_LABELS[field]).join(", ");

/** Where the layer is `t` seconds into its own time — the values a new keyframe would hold. */
export function placementAt(item: SequenceItem, t: number): Record<AnimatedField, number> {
  const base = staticState(item);
  return Object.fromEntries(ANIMATED_FIELDS.map((field) =>
    [field, round(item.keyframes?.length ? fieldAt(item.keyframes, field, t, base[field]) : base[field])])) as Record<AnimatedField, number>;
}

/**
 * One moment pinned, or re-pinned, `t` seconds into the item's own time.
 *
 * A field arriving for the first time is anchored on the last moment already pinned
 * *before* this one, holding the value it has there today, so the layer travels from
 * where it was to where it has just been put and then stays. Without an anchor the field
 * would be named by exactly one keyframe, which is a constant, and a drag meant to move
 * something at one moment would quietly move it for the whole shot. Anchoring the
 * moments *after* it as well was tried and rejected: that makes one drag a bounce out and
 * back, which is not what anybody dragging something means.
 */
export function setKeyframe(item: SequenceItem, t: number, values: Partial<Record<AnimatedField, number>>, by = ""): TransformKeyframe[] {
  const at = roundMoment(Math.max(0, t));
  const existing = item.keyframes ?? [];
  const fresh = (Object.keys(values) as AnimatedField[]).filter((field) => !animatedFields(existing).has(field));
  const held = placementAt(item, 0);
  const anchor = fresh.length ? [...existing].reverse().find((key) => key.t < at - SAME_MOMENT) : undefined;
  const anchored = existing.map((key) => (key === anchor
    ? { ...key, ...Object.fromEntries(fresh.map((field) => [field, held[field]])) }
    : key));
  const rounded = Object.fromEntries(Object.entries(values).map(([field, value]) => [field, round(value)]));
  const index = anchored.findIndex((key) => Math.abs(key.t - at) < SAME_MOMENT);
  if (index >= 0) return anchored.map((key, n) => (n === index ? { ...key, ...rounded } : key));
  const made: TransformKeyframe = { ...rounded, t: at, ease: "linear", by };
  return [...anchored, made].sort((a, b) => a.t - b.t);
}

/** The first keyframe of a move: everything the layer is now, pinned where the playhead is. */
export const pinPlacement = (item: SequenceItem, t: number, by = "") =>
  setKeyframe(item, t, Object.fromEntries(PLACEMENT_FIELDS.map((field) => [field, placementAt(item, t)[field]])), by);

/** The same, for the one thing a move is not: how loud this layer is at this moment. */
export const pinVolume = (item: SequenceItem, t: number, by = "") =>
  setKeyframe(item, t, { volume: placementAt(item, t).volume }, by);

/**
 * A keyframe moved to another moment, kept in order and never on top of its neighbour.
 *
 * Two keyframes at one moment is the one ordering a reader cannot resolve, so a retime
 * that lands on another one steps past it rather than being refused mid-edit. It steps
 * forward first and backward if forward would leave the shot — dropping one onto the
 * keyframe at the very end has nowhere to go but back, and a moment past the end is an
 * edit the engine would refuse.
 */
export function retimeKeyframe(keyframes: TransformKeyframe[], index: number, t: number, max = Infinity): TransformKeyframe[] {
  const rest = keyframes.filter((_, n) => n !== index);
  const free = (at: number) => at >= 0 && at <= max + 1e-9 && !rest.some((key) => Math.abs(key.t - at) < SAME_MOMENT);
  const walk = (from: number, step: 1 | -1) => {
    let at = from;
    for (let tries = 0; tries <= rest.length + 1; tries++) {
      if (free(at)) return at;
      at = roundMoment(at + step * SAME_MOMENT);
    }
    return null;
  };
  const start = roundMoment(Math.max(0, Math.min(max, t)));
  const moved = { ...keyframes[index], t: walk(start, 1) ?? walk(start, -1) ?? keyframes[index].t };
  return [...rest, moved].sort((a, b) => a.t - b.t);
}

/** One moment unpinned. An empty result is a layer that holds still again. */
export const removeKeyframe = (keyframes: TransformKeyframe[], index: number) => keyframes.filter((_, n) => n !== index);

/** How much bigger a Ken Burns move ends than it starts. Slow enough to read as drift. */
const KEN_BURNS_SCALE = 1.14;
/** How much of that growth is spent travelling rather than centring, so it moves as it grows. */
const KEN_BURNS_DRIFT = 0.35;

/**
 * A slow push across a shot, as two ordinary keyframes.
 *
 * Ken Burns is not a feature here. It is what this feature does to a layer that happens to
 * be a still: the same `x`, `y`, `width` and `height` any layer animates, travelling from
 * where the layer is now to somewhere bigger and off to one side, over the whole shot.
 * `linear` because a drift that eases is a drift that visibly starts and stops.
 */
export function kenBurns(item: SequenceItem, seconds: number, by = ""): TransformKeyframe[] {
  const base = staticState(item);
  const width = round(base.width * KEN_BURNS_SCALE), height = round(base.height * KEN_BURNS_SCALE);
  const grownX = width - base.width, grownY = height - base.height;
  return [
    { t: 0, x: round(base.x), y: round(base.y), width: round(base.width), height: round(base.height), ease: "linear", by },
    { t: roundMoment(Math.max(0.1, seconds)), width, height, ease: "linear", by,
      // Half the growth centres the frame; the rest of it is the travel.
      x: round(base.x - grownX / 2 - grownX * KEN_BURNS_DRIFT),
      y: round(base.y - grownY / 2 + grownY * KEN_BURNS_DRIFT) },
  ];
}
