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
      score: sequence.plan.score,
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

/** How the list is ordered. Score first: with forty candidates, ranking is the point. */
export type VideoSort = "score" | "order" | "duration";

export const SORTS: Array<{ value: VideoSort; label: string }> = [
  { value: "score", label: "Best first" },
  { value: "order", label: "Order in the video" },
  { value: "duration", label: "Longest first" },
];

export function sortVideos(videos: ProjectVideo[], sort: VideoSort): ProjectVideo[] {
  if (sort === "order") return videos;
  const by = sort === "score"
    // An unscored video was never a proposal, so it has no place in a ranking by
    // score. It sorts last rather than sorting as a zero it did not earn.
    ? (v: ProjectVideo) => (v.score === null ? -1 : v.score)
    : (v: ProjectVideo) => v.durationSec;
  return videos.toSorted((a, b) => by(b) - by(a));
}

export function statusCounts(videos: ProjectVideo[]): Record<SequenceStatus | "all", number> {
  const counts = { all: videos.length, pending: 0, edited: 0, approved: 0, rendered: 0 };
  for (const v of videos) counts[v.status] += 1;
  return counts;
}
