import type { SequenceItem, VideoSequence } from "../edl";
import { sequenceFrames } from "../sequences";

/**
 * Which tracks are picture and which are sound.
 *
 * A layer is a z-order for the picture: higher draws over lower. Sound has no z-order,
 * so a piece of music sitting on "Track 3" says something untrue — it is not over
 * anything — and a piece of music sitting on Main is worse, because Main is the
 * picture's own running order and a transparent scene there holds black frames for as
 * long as the music lasts.
 *
 * Nothing here changes the EDL: a track is still a layer number, and both interfaces
 * write the same `layer`. What this module adds is the reading of it — which layers
 * carry only sound, where they belong on screen, and which one a new sound goes to —
 * so the timeline can keep sound in its own region and every gesture lands there.
 */

/** A shot whose picture contributes nothing: a lifted audio track, or a scene that is only sound. */
export function audioOnly(item: Pick<SequenceItem, "mediaId" | "hidden" | "clip">): boolean {
  // A shot separated from its picture keeps its media and is hidden; that is the whole
  // definition of the audio half of `item.detachAudio`.
  if (item.mediaId) return !!item.hidden;
  const edits = item.clip.edits;
  return edits.length > 0 && edits.every(edit => edit.type === "music" || edit.type === "sfx");
}

export type TrackKind = "video" | "audio";
export type Lane = { layer: number; kind: TrackKind };

/**
 * Every track on this timeline, in the order they are drawn: picture from the top down,
 * the way the layers stack, then sound underneath in the order it was added.
 *
 * One picture item anywhere on a layer makes the whole layer a picture track — a title
 * card with a sting on it is still something you see. Layer 0 is always the picture's
 * running order, even when an older project left a sound sitting on it.
 */
export function trackLanes(sequence: Pick<VideoSequence, "items">): Lane[] {
  const kinds = new Map<number, TrackKind>([[0, "video"]]);
  for (const item of sequence.items) {
    const layer = item.layer ?? 0;
    if (layer === 0) continue;
    if (audioOnly(item)) { if (!kinds.has(layer)) kinds.set(layer, "audio"); }
    else kinds.set(layer, "video");
  }
  const lanes = [...kinds].map(([layer, kind]) => ({ layer, kind }));
  return [
    ...lanes.filter(lane => lane.kind === "video").sort((a, b) => b.layer - a.layer),
    ...lanes.filter(lane => lane.kind === "audio").sort((a, b) => a.layer - b.layer),
  ];
}

/**
 * What each track is called. Picture tracks count up from Main, sound tracks from the
 * first one, so the names follow what is on screen rather than the layer numbers behind
 * it: deleting the middle overlay must not leave "Main, Track 2, Track 4".
 */
export function laneLabels(lanes: Lane[]): Map<number, string> {
  const labels = new Map<number, string>();
  const ascending = (kind: TrackKind) => lanes.filter(lane => lane.kind === kind).map(lane => lane.layer).sort((a, b) => a - b);
  ascending("video").forEach((layer, index) => labels.set(layer, index === 0 ? "Main" : `Track ${index + 1}`));
  ascending("audio").forEach((layer, index) => labels.set(layer, index === 0 ? "Audio" : `Audio ${index + 1}`));
  return labels;
}

/** The layer above everything, which is where a new picture track goes. */
export const nextLayer = (sequence: Pick<VideoSequence, "items">) =>
  Math.max(0, ...sequence.items.map(item => item.layer ?? 0)) + 1;

/**
 * Where a new sound belongs: the first audio track with room for it at that moment, so
 * a second piece of music stacks under the first instead of burying it, and a brand new
 * track when every existing one is already sounding.
 */
export function audioLayer(sequence: VideoSequence, at: number, duration: number): number {
  const fps = sequence.output.fps;
  const placed = sequenceFrames(sequence).items;
  for (const lane of trackLanes(sequence)) {
    if (lane.kind !== "audio") continue;
    const busy = placed.some(entry => (entry.item.layer ?? 0) === lane.layer
      && entry.from / fps < at + duration - 1e-6 && (entry.from + entry.duration) / fps > at + 1e-6);
    if (!busy) return lane.layer;
  }
  return nextLayer(sequence);
}

/**
 * The track a gesture actually lands on. Aiming a sound at the picture sends it to the
 * audio region and aiming a picture at the audio region sends it to a new track above,
 * so a drag can be sloppy without the result being wrong. The ghost is drawn from what
 * this returns, so the redirection is visible before the pointer is released.
 */
export function routeLayer(sequence: VideoSequence, aim: Lane, sound: boolean, at: number, duration: number): number {
  if (sound === (aim.kind === "audio")) return aim.layer;
  return sound ? audioLayer(sequence, at, duration) : nextLayer(sequence);
}
