import type { VideoSequence } from "../edl";
import { sequenceFrames } from "../sequences";

/** A time an interaction can lock onto, with the reason it exists so the UI can label the guide. */
export type SnapPoint = { at: number; kind: "origin" | "playhead" | "edge" };
export type SnapResult = { at: number; guide: SnapPoint | null };

const byDistance = (value: number) => (a: SnapPoint, b: SnapPoint) => Math.abs(a.at - value) - Math.abs(b.at - value);
/** The origin and the playhead outrank a clip edge when both are within reach. */
const rank = { playhead: 0, origin: 1, edge: 2 } as const;

/**
 * Candidate times for a timeline interaction: the origin, the playhead, and every
 * other item's start and end. Pure so pointer, keyboard and drop paths all agree.
 */
export function snapTargets(sequence: VideoSequence, options: { excludeId?: string; playheadSec?: number } = {}): SnapPoint[] {
  const fps = sequence.output.fps;
  const points: SnapPoint[] = [{ at: 0, kind: "origin" }];
  if (options.playheadSec != null && Number.isFinite(options.playheadSec) && options.playheadSec > 0) points.push({ at: options.playheadSec, kind: "playhead" });
  for (const { item, from, duration } of sequenceFrames(sequence).items) {
    if (item.id === options.excludeId) continue;
    points.push({ at: from / fps, kind: "edge" }, { at: (from + duration) / fps, kind: "edge" });
  }
  const seen = new Map<string, SnapPoint>();
  for (const point of points) {
    const key = point.at.toFixed(4);
    const existing = seen.get(key);
    if (!existing || rank[point.kind] < rank[existing.kind]) seen.set(key, point);
  }
  return [...seen.values()].sort((a, b) => a.at - b.at);
}

/** Pull a single time onto the nearest target within tolerance. */
export function snapTime(value: number, targets: SnapPoint[], tolerance: number): SnapResult {
  if (!(tolerance > 0)) return { at: value, guide: null };
  const reachable = targets.filter(point => Math.abs(point.at - value) <= tolerance);
  if (!reachable.length) return { at: value, guide: null };
  const best = reachable.sort((a, b) => rank[a.kind] - rank[b.kind] || byDistance(value)(a, b))[0];
  return { at: best.at, guide: best };
}

/**
 * Pull a moving span onto a target by whichever of its two edges is closest, so a clip
 * snaps flush against its neighbour on either side rather than only by its head.
 */
export function snapSpan(at: number, duration: number, targets: SnapPoint[], tolerance: number): SnapResult {
  if (!(tolerance > 0)) return { at, guide: null };
  const head = snapTime(at, targets, tolerance);
  const tail = snapTime(at + duration, targets, tolerance);
  if (!head.guide && !tail.guide) return { at, guide: null };
  if (head.guide && tail.guide) {
    const headDistance = Math.abs(head.guide.at - at), tailDistance = Math.abs(tail.guide.at - (at + duration));
    if (rank[head.guide.kind] < rank[tail.guide.kind] || (rank[head.guide.kind] === rank[tail.guide.kind] && headDistance <= tailDistance)) return head;
    return { at: Math.max(0, tail.guide.at - duration), guide: tail.guide };
  }
  if (head.guide) return head;
  // A span that would have to start before the origin never reaches its tail target, so it has
  // no guide to draw: a line at a time the clip is nowhere near would be a lie.
  const start = tail.guide!.at - duration;
  return start < 0 ? { at: 0, guide: null } : { at: start, guide: tail.guide! };
}

/** How far a catch reaches as a share of the axis, so the pull feels the same however big the preview is drawn. */
const CATCH_REACH = .012;
/** Under this many pixels a catch is not felt at all, so a small preview keeps a reach it can express. */
const CATCH_FLOOR = 2;
/** Together, the catches on an axis may claim at most this share of the travel there is. */
const CATCH_SHARE = 1 / 3;

/**
 * The same magnetism for the canvas: pull one axis of a moving box onto the frame's leading
 * edge, its centre, or its trailing edge. Distances are in the frame's own pixels, and the
 * guide is where a line should be drawn to show what it caught.
 *
 * A catch is a suggestion, never a track. Its reach is measured against the frame rather than
 * the screen — a fixed pixel count is a nudge on a full-size preview and a cage on a thumbnail
 * — and the three catches on an axis together never claim more than a third of the travel the
 * box has. Whatever the sizes, every position between the lines stays reachable: a box nearly
 * as wide as its frame can still sit slightly off centre, and one exactly as wide, which has
 * nowhere to go, is left alone entirely.
 */
export function snapAxis(start: number, size: number, extent: number, tolerance: number): { delta: number; guide: number } | null {
  if (!(tolerance > 0) || !Number.isFinite(start) || !Number.isFinite(size) || !(extent > 0)) return null;
  const room = Math.max(0, extent - size);
  // Six, because three catches each pull from both sides.
  const reach = Math.min(tolerance, Math.max(CATCH_FLOOR, extent * CATCH_REACH), room * CATCH_SHARE / 6);
  if (!(reach > 0)) return null;
  const candidates = [{ at: 0, guide: 0 }, { at: room / 2, guide: extent / 2 }, { at: room, guide: extent }];
  let best: { delta: number; guide: number } | null = null;
  for (const candidate of candidates) {
    const delta = candidate.at - start;
    if (Math.abs(delta) <= reach && (!best || Math.abs(delta) < Math.abs(best.delta))) best = { delta, guide: candidate.guide };
  }
  return best;
}
