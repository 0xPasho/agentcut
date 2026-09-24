import type { TimeMap } from "./timeline";

export function timeLabel(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${rest.toFixed(rest % 1 > .001 ? 1 : 0).padStart(rest % 1 > .001 ? 4 : 2, "0")}`;
}

/**
 * A moment as an editor reads it: minutes, seconds, and which frame inside that second.
 *
 * `timeLabel` rounds to a tenth, which is three frames at thirty a second — fine for a
 * ruler whose ticks are a second apart and useless for one whose ticks are a frame apart,
 * where it prints the same number several times in a row and reads as a ruler that has
 * stopped counting. The far end of the zoom is exactly that ruler.
 */
export function frameLabel(seconds: number, fps: number) {
  const rate = Math.max(1, Math.round(fps));
  const total = Math.round(seconds * rate);
  const frame = ((total % rate) + rate) % rate;
  const whole = (total - frame) / rate;
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}:${String(frame).padStart(2, "0")}`;
}

/**
 * Seconds from what somebody typed into a time field.
 *
 * `12.5` is seconds, `1:05` is minutes and seconds, `1:02:03` is hours as well, and a
 * fourth part is the frame inside the last second — `0:00:12:07` is the seventh frame of
 * the twelfth second, which is how a moment is named anywhere else in this trade and the
 * only way to ask for one frame out of a two-hour recording without counting in decimals.
 * `null` when it is not a time at all, so a field can say so rather than jump to zero.
 */
export function parseTimecode(text: string, fps: number): number | null {
  const parts = text.trim().split(":");
  if (!parts.length || parts.length > 4) return null;
  if (parts.some(part => !/^\d+(\.\d+)?$/.test(part.trim()))) return null;
  const values = parts.map(part => Number(part));
  if (!values.every(Number.isFinite)) return null;
  if (parts.length < 4) return values.reduce((total, value) => total * 60 + value, 0);
  const [hours, minutes, secs, frame] = values;
  return hours * 3600 + minutes * 60 + secs + frame / Math.max(1, fps);
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
