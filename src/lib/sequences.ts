import type { SequenceItem, Transition, VideoSequence } from "./edl";
import { buildTimeMap } from "./timeline";

/** A transition as the renderer needs it: the blend, and how many frames it actually gets. */
export type ResolvedTransition = { transition: Transition; frames: number };
export type ResolvedItem = {
  item: SequenceItem;
  from: number;
  duration: number;
  /** The blend that opens this shot, over its first `frames` frames. */
  transition: ResolvedTransition | null;
  /** Frames of this shot's tail the next shot blends over. Its half of the same joint. */
  outFrames: number;
};

/**
 * One shared frame allocation for preview, timeline and exports.
 *
 * A transition costs time rather than footage: the incoming shot starts `frames`
 * earlier and the two play at once over that overlap, so the programme gets shorter
 * by exactly what every joint takes. Nothing is trimmed, so removing a transition
 * puts the timing back precisely.
 *
 * What a joint cannot afford is clamped here instead of refused. The operation that
 * writes a transition validates it against the shots it joins and rejects the
 * impossible with a message; after that, shortening or removing a neighbour must
 * never fail because something else on the track held a transition.
 */
export function sequenceFrames(sequence: VideoSequence) {
  const fps = sequence.output.fps;
  const cursors = new Map<number, number>();
  const last = new Map<number, number>();
  const items: ResolvedItem[] = [];
  let end = 0;
  for (const item of sequence.items) {
    const layer = item.layer ?? 0;
    const duration = Math.max(1, Math.round(buildTimeMap(item.clip).duration * fps));
    const cursor = cursors.get(layer) ?? 0;
    const previousIndex = last.get(layer);
    const previous = previousIndex === undefined ? null : items[previousIndex];
    let frames = 0;
    if (item.transition && previous) {
      // A shot the previous transition already spent cannot be spent twice, and each
      // shot keeps at least one frame of its own.
      const free = previous.duration - (previous.transition?.frames ?? 0);
      frames = Math.max(0, Math.min(Math.round(item.transition.durationSec * fps), duration - 1, free - 1));
    }
    const from = item.at == null ? Math.max(0, cursor - frames) : Math.round(item.at * fps);
    // A shot pinned to a fixed time blends over whatever overlap it actually has.
    if (item.at != null) frames = Math.max(0, Math.min(frames, cursor - from));
    if (previous && frames > 0) previous.outFrames = frames;
    cursors.set(layer, from + duration);
    last.set(layer, items.length);
    end = Math.max(end, from + duration);
    items.push({ item, from, duration, transition: frames > 0 && item.transition ? { transition: item.transition, frames } : null, outFrames: 0 });
  }
  return { items, duration: Math.max(1, end) };
}

/** A shot's audio ramps: how many frames it opens over, closes over, and how long it is. */
export type AudioFade = { inFrames: number; outFrames: number; durationFrames: number };

/**
 * A shot's own gain at `frame`, across the joints at either end of it.
 *
 * During an overlap both shots are sounding. Left alone that is not a cut and not a
 * blend — it is two takes at once, louder than either — so the picture's blend is
 * matched by an equal-power crossfade: the incoming shot rises as sin, the outgoing
 * falls as cos of the same progress, and their powers sum to one, so the joint holds
 * its loudness instead of dipping in the middle the way a linear pair does.
 *
 * A template's transition sting (`sound.transitions`) is a separate sound on its own
 * layer and is untouched by this. The two are meant to compose.
 */
export function crossfadeGain(frame: number, fade: AudioFade): number {
  const ramp = (progress: number) => Math.sin(Math.max(0, Math.min(1, progress)) * Math.PI / 2);
  let gain = 1;
  if (fade.inFrames > 0) gain *= ramp(frame / fade.inFrames);
  if (fade.outFrames > 0) gain *= ramp((fade.durationFrames - frame) / fade.outFrames);
  return gain;
}

/** A joint on a track: the shot before this one, and what the two can afford between them. */
export type TransitionJoint = {
  previous: SequenceItem;
  /** The longest blend this joint can hold, in frames. Each shot keeps at least one of its own. */
  maxFrames: number;
  /** For a shot pinned to a fixed time, the overlap it already has. `null` when it follows on its own. */
  overlapFrames: number | null;
};

/**
 * Every joint on this timeline, in one pass over the allocation.
 *
 * Both interfaces ask the same question here — the operation, to refuse an impossible
 * transition with a number in the message; the timeline, to say what a joint has room
 * for before anyone asks for it.
 */
export function transitionJoints(sequence: VideoSequence): Map<string, TransitionJoint> {
  const tracks = new Map<number, ResolvedItem[]>();
  for (const entry of sequenceFrames(sequence).items) {
    const layer = entry.item.layer ?? 0;
    const track = tracks.get(layer) ?? [];
    track.push(entry);
    tracks.set(layer, track);
  }
  const joints = new Map<string, TransitionJoint>();
  for (const track of tracks.values()) {
    for (let index = 1; index < track.length; index++) {
      const own = track[index], before = track[index - 1];
      // What the outgoing shot has left after its own opening blend, and what the incoming
      // shot has left before the next one starts. Each keeps at least a frame of its own.
      const free = before.duration - (before.transition?.frames ?? 0);
      joints.set(own.item.id, {
        previous: before.item,
        maxFrames: Math.max(0, Math.min(own.duration - own.outFrames, free) - 1),
        overlapFrames: own.item.at == null ? null : Math.max(0, before.from + before.duration - own.from),
      });
    }
  }
  return joints;
}

/** The one joint a transition on this shot would sit in, or `null` if it opens its track. */
export const transitionJoint = (sequence: VideoSequence, itemId: string): TransitionJoint | null =>
  transitionJoints(sequence).get(itemId) ?? null;
