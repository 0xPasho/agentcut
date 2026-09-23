import type { TimeMap } from "./timeline";

export function timeLabel(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${rest.toFixed(rest % 1 > .001 ? 1 : 0).padStart(rest % 1 > .001 ? 4 : 2, "0")}`;
}

export function sourceAt(map: TimeMap, output: number) {
  for (const span of map.spans) {
    if (output <= span.outStart + span.srcEnd - span.srcStart) return span.srcStart + Math.max(0, output - span.outStart);
  }
  return map.spans.at(-1)?.srcEnd ?? 0;
}

/** A clip narrower than this is impossible to grab, so it is drawn wider — but only into empty space. */
export const MIN_CLIP_PX = 40;
/** A transition handle is 16px wide; two closer than this would sit on top of each other. */
export const MIN_JOINT_PX = 18;

export type LaneBox = { left: number; width: number; room: number };

/**
 * Where every clip on one track is drawn. Zoomed out, a two-second clip is a couple of
 * pixels, so each one claims a minimum width — and that minimum is what made them overlap:
 * a clip borrowed from its neighbour and covered its start. A clip may only borrow the empty
 * space in front of it, so `room`, the distance to the clip that follows, caps the minimum.
 * Clips that truly overlap in the sequence keep their real width and still read as stacked.
 */
export function laneBoxes(entries: { id: string; from: number; duration: number }[], pxPerFrame: number) {
  const ordered = [...entries].sort((a, b) => a.from - b.from);
  const boxes = new Map<string, LaneBox>();
  for (const [index, entry] of ordered.entries()) {
    const left = entry.from * pxPerFrame;
    const next = ordered[index + 1];
    const room = next ? next.from * pxPerFrame - left : Infinity;
    boxes.set(entry.id, { left, width: Math.max(entry.duration * pxPerFrame, Math.min(MIN_CLIP_PX, room)), room });
  }
  return boxes;
}
