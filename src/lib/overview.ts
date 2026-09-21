import type { Clip, Edl, VideoSequence } from "./edl";
import type { SequenceStatus } from "./plan/schema";
import { sequenceFrames } from "./sequences";
import { buildTimeMap } from "./timeline";

/**
 * One output of this project, however it is currently stored.
 *
 * `clip.promote` moves a generated clip into `sequences` under the same id on its
 * first edit, so `clips` and `sequences` are one collection observed mid-migration.
 * Showing them as two sections is what makes an edited project announce "0 clips"
 * directly above the clip it is showing.
 */
export type ProjectVideo = {
  id: string;
  title: string;
  /** A laid-out timeline, or a generated cut that becomes one on its first edit. */
  kind: "sequence" | "clip";
  durationSec: number;
  shots: number;
  status: SequenceStatus;
  /** How strongly the agent rated the moment. Only generated cuts carry one. */
  score: number | null;
  tags: string[];
  summary: string;
  error: string | null;
  /** Where this sits in the long video, for a chronological overview. */
  sourceStart: number | null;
  sequence: VideoSequence | null;
  clip: Clip | null;
};

export function projectVideos(edl: Edl): ProjectVideo[] {
  const fromSequences = edl.sequences.map((sequence): ProjectVideo => {
    const footage = sequence.items.find((item) => item.mediaId !== null);
    return {
      id: sequence.id,
      title: sequence.title,
      kind: "sequence",
      durationSec: sequenceFrames(sequence).duration / sequence.output.fps,
      shots: sequence.items.length,
      status: sequence.plan.status,
      score: null,
      tags: sequence.plan.tags,
      summary: sequence.plan.summary,
      error: sequence.plan.reasons.error ?? null,
      sourceStart: footage ? footage.clip.start : null,
      sequence,
      clip: null,
    };
  });

  const fromClips = edl.clips.map((clip): ProjectVideo => ({
    id: clip.id,
    title: clip.title,
    kind: "clip",
    durationSec: buildTimeMap(clip).duration,
    shots: 1,
    status: "pending",
    score: clip.score,
    tags: clip.tags,
    summary: clip.reason,
    error: null,
    sourceStart: clip.start,
    sequence: null,
    clip,
  }));

  // Chronological through the long video: the order the moments were said, which is
  // the one order that does not rearrange itself as clips promote into timelines.
  // Anything with no footage behind it — a blank canvas — keeps its own order at the end.
  return [...fromSequences, ...fromClips].sort((a, b) => {
    if (a.sourceStart === null || b.sourceStart === null) return Number(a.sourceStart === null) - Number(b.sourceStart === null);
    return a.sourceStart - b.sourceStart;
  });
}
