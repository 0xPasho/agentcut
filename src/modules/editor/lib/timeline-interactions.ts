import type { MediaSource, VideoSequence } from "../types";
import { sequenceFrames } from "./sequences";
import { buildTimeMap, clipFrames, type TimeMap } from "./timeline";
import type { EditorOperation } from "./operations";

/** At a cut boundary, a left edge keeps the following span; a right edge keeps the preceding one. */
export function timelineOutputToSource(map: TimeMap, seconds: number, edge: "start" | "end"): number {
  const spans = edge === "start" ? [...map.spans].reverse() : map.spans;
  const span = spans.find(s => seconds >= s.outStart && seconds <= s.outStart + s.srcEnd - s.srcStart);
  if (span) return span.srcStart + seconds - span.outStart;
  return seconds <= 0 ? map.spans[0].srcStart : map.spans.at(-1)!.srcEnd;
}

/** Build the same bounded trim transaction for pointer, keyboard and agent callers. */
export function buildTimelineTrim(sequence: VideoSequence, itemId: string, edge: "start" | "end", outputDeltaSeconds: number, media: MediaSource[]): EditorOperation[] {
  if (!Number.isFinite(outputDeltaSeconds)) throw new Error("Trim movement must be finite");
  const frames = sequenceFrames(sequence);
  const entry = frames.items.find(i => i.item.id === itemId);
  if (!entry) throw new Error("Timeline item not found");
  const item = entry.item, clip = item.clip, map = buildTimeMap(clip);
  const fps = sequence.output.fps, minimum = 1 / fps;
  const delta = Math.round(outputDeltaSeconds * fps) / fps;
  if (!delta) return [];
  const source = item.mediaId === null ? null : media.find(m => m.id === item.mediaId);
  if (item.mediaId !== null && !source) throw new Error("Timeline item references missing media");
  let start = clip.start, end = clip.end;
  if (edge === "start") {
    const movement = Math.min(delta, Math.max(0, map.duration - minimum));
    start = movement < 0 ? Math.max(0, clip.start + movement) : clip.start + timelineOutputToSource(map, movement, "start");
    // A layer cannot extend before the start of its timeline.
    if ((item.layer ?? 0) !== 0 && movement < 0) start = Math.max(start, clip.start - entry.from / fps);
    start = Math.min(start, end - minimum);
  } else {
    const duration = Math.max(minimum, map.duration + delta);
    end = delta > 0 ? clip.end + delta : clip.start + timelineOutputToSource(map, duration, "end");
    end = Math.max(start + minimum, Math.min(end, source?.durationSec ?? Infinity));
  }
  if (start === clip.start && end === clip.end) return [];
  const patch: { start?: number; end?: number; edits?: typeof clip.edits } = edge === "start" ? { start } : { end };
  // A standalone title/image/audio represents its entire canvas scene; extend it with the scene.
  if (item.mediaId === null && clip.edits.length === 1 && clip.edits[0].type !== "silence" && clip.edits[0].t === 0 && Math.abs(clip.edits[0].d - (clip.end - clip.start)) < 0.001) {
    patch.edits = [{ ...clip.edits[0], t: 0, d: end - start }];
  }
  const operations: EditorOperation[] = [{ type: "item.patch", sequenceId: sequence.id, itemId, patch, before: { start: clip.start, end: clip.end, edits: clip.edits } }];
  if ((item.layer ?? 0) === 0) {
    const ordered = frames.items.filter(i => (i.item.layer ?? 0) === 0).sort((a, b) => a.from - b.from);
    operations.push({ type: "item.reorder", sequenceId: sequence.id, itemId, layer: 0, index: ordered.findIndex(i => i.item.id === itemId) });
  } else if (edge === "start") {
    // Resolve the trimmed map through the domain engine's source-anchored edits.
    const shift = start - clip.start;
    const edits = patch.edits ?? clip.edits.flatMap(edit => {
      const t = edit.t - shift, stop = Math.min(end - start, t + edit.d);
      return stop > Math.max(0, t) ? [{ ...edit, t: Math.max(0, t), d: stop - Math.max(0, t) }] : [];
    });
    const duration = clipFrames(buildTimeMap({ ...clip, start, end, edits }), fps);
    operations.push({ type: "item.place", sequenceId: sequence.id, itemId, patch: { at: Math.max(0, (entry.from + entry.duration - duration) / fps) }, before: { at: item.at ?? null } });
  }
  return operations;
}

/** Free placement preserves every other item's resolved time, including auto-follow items. */
export function buildTimelineMove(sequence: VideoSequence, itemId: string, at: number, layer: number): EditorOperation[] {
  return buildTimelineGroupMove(sequence, [{ itemId, at, layer }]);
}

/**
 * Move several items in one transaction. Everything that was not picked up keeps the time it
 * resolved to, so dragging a selection never reshuffles the clips around it.
 */
export function buildTimelineGroupMove(sequence: VideoSequence, moves: { itemId: string; at: number; layer: number }[]): EditorOperation[] {
  if (!moves.length) return [];
  const seen = new Set<string>();
  for (const move of moves) {
    if (!Number.isFinite(move.at) || move.at < 0 || !Number.isInteger(move.layer) || move.layer < 0) throw new Error("Invalid timeline placement");
    if (!sequence.items.some(item => item.id === move.itemId)) throw new Error("Timeline item not found");
    if (seen.has(move.itemId)) throw new Error("An item can only be placed once in a move");
    seen.add(move.itemId);
  }
  const fps = sequence.output.fps;
  return sequenceFrames(sequence).items.flatMap(({ item, from }): EditorOperation[] => {
    const move = moves.find(candidate => candidate.itemId === item.id);
    if (!move && item.at != null) return [];
    return [{ type: "item.place", sequenceId: sequence.id, itemId: item.id,
      patch: move ? { at: Math.round(move.at * fps) / fps, layer: move.layer } : { at: from / fps },
      before: { at: item.at ?? null, layer: item.layer ?? 0 } }];
  });
}

/**
 * Whether a span would land on top of something already on that track. Overlap is legal —
 * items stack — but it hides one clip behind another, so the editor says so before it happens.
 */
export function timelineCollides(sequence: VideoSequence, layer: number, at: number, duration: number, ignore: Iterable<string> = []): boolean {
  if (!(duration > 0)) return false;
  const skip = new Set(ignore);
  const fps = sequence.output.fps;
  return sequenceFrames(sequence).items.some(({ item, from, duration: span }) => {
    if (skip.has(item.id) || (item.layer ?? 0) !== layer) return false;
    const start = from / fps, end = (from + span) / fps;
    return at < end - 1e-6 && start < at + duration - 1e-6;
  });
}

/**
 * Slip: change which part of the footage a clip shows without moving it or changing its length.
 * The transcript and crop follow the footage — the engine's own trim rebases them — while the
 * overlays the author wrote stay where they were put, which is why the edits are passed through.
 */
export function buildTimelineSlip(sequence: VideoSequence, itemId: string, deltaSeconds: number, media: MediaSource[]): EditorOperation[] {
  if (!Number.isFinite(deltaSeconds)) throw new Error("Slip movement must be finite");
  const item = sequence.items.find(candidate => candidate.id === itemId);
  if (!item) throw new Error("Timeline item not found");
  if (item.mediaId === null) throw new Error("A scene with no footage has nothing to slip");
  const source = media.find(candidate => candidate.id === item.mediaId);
  if (!source) throw new Error("Timeline item references missing media");
  const clip = item.clip, fps = sequence.output.fps;
  const delta = Math.max(-clip.start, Math.min(source.durationSec - clip.end, Math.round(deltaSeconds * fps) / fps));
  if (!delta) return [];
  return [{ type: "item.patch", sequenceId: sequence.id, itemId,
    patch: { start: clip.start + delta, end: clip.end + delta, edits: clip.edits },
    before: { start: clip.start, end: clip.end } }];
}
