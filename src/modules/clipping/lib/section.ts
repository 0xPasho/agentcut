import { CaptionStyle, centerCrop, SELECTION_AUTHOR, type Clip, type SequenceItem } from "../../editor/types";
import type { Beat } from "../../plan/types";
import { wordsForClip, type Transcript } from "../../transcription/lib/transcript";
import { tightenBoundaries } from "./boundaries";
import type { AgentSectionProposal, AgentSegment } from "../types";

/**
 * A long video is one sequence of many stretches of one recording, in the order they
 * happened. This turns what the agent proposed into that timeline.
 *
 * It is pure so the arithmetic is testable without an agent, an ffmpeg or a database:
 * the interesting part is not calling the model, it is what happens when the model
 * hands back segments that overlap, run backwards, sit past the end of the file or
 * are two seconds long.
 */

/** Keep the order it happened in, drop the impossible, and never let two stretches overlap. */
export function cleanSegments(segments: AgentSegment[], o: { durationSec: number; minSegmentSec: number }): AgentSegment[] {
  const kept: AgentSegment[] = [];
  const sorted = [...segments]
    .map(s => ({ ...s, start: Math.max(0, Math.min(s.start, s.end)), end: Math.min(o.durationSec, Math.max(s.start, s.end)) }))
    .filter(s => s.end - s.start > 0)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  for (const segment of sorted) {
    const previous = kept[kept.length - 1];
    // Overlap is a mistake, not an instruction: the same seconds twice in one video is
    // a stutter a viewer hears. The later stretch starts where the earlier one ended.
    const start = previous ? Math.max(segment.start, previous.end) : segment.start;
    if (segment.end - start < o.minSegmentSec) continue;
    kept.push({ ...segment, start, end: segment.end });
  }
  return kept;
}

export const keptSeconds = (segments: Array<{ start: number; end: number }>) =>
  segments.reduce((total, s) => total + (s.end - s.start), 0);

export type SectionTimeline = {
  items: SequenceItem[];
  /** One per kept stretch, in order — what the video is navigated by. */
  beats: Beat[];
  keptSec: number;
  warnings: string[];
};

/**
 * The timeline itself. Each stretch becomes one ordinary shot with its own words, so
 * every later pass — the template's dead-air cut, captions, a hand trim in the UI —
 * works on it exactly as it works on a clip. There is nothing special about a long
 * video downstream of here, which is the point.
 */
export function sectionTimeline(
  proposal: AgentSectionProposal,
  o: {
    transcript: Transcript;
    probe: { width: number; height: number; fps: number; durationSec: number };
    output: { width: number; height: number; fps: number };
    minSegmentSec: number;
    /** The imported source these stretches are cut from. */
    mediaId: string;
    /** Loudness peaks, so a boundary is never tightened past a reaction. */
    peaks?: number[];
    /** Written as chapters on the sequence's plan. */
    chapters: boolean;
    itemId: (index: number) => string;
  },
): SectionTimeline {
  const warnings: string[] = [];
  const segments = cleanSegments(proposal.segments, { durationSec: o.probe.durationSec, minSegmentSec: o.minSegmentSec });
  const dropped = proposal.segments.length - segments.length;
  if (dropped > 0) warnings.push(`${dropped} of ${proposal.segments.length} proposed stretches were dropped: shorter than ${o.minSegmentSec}s once overlaps were settled, or outside the recording`);
  if (!segments.length) throw new Error("agent produced no usable stretches for a long video");

  const crop = centerCrop(o.probe.width, o.probe.height, o.output.width, o.output.height);
  const items: SequenceItem[] = [];
  const beats: Beat[] = [];
  for (const [index, segment] of segments.entries()) {
    const [start, end] = tightenBoundaries(o.transcript.words, segment.start, segment.end, {
      duration: o.probe.durationSec, fps: o.probe.fps, peaks: o.peaks ?? [],
    });
    if (end - start < o.minSegmentSec) {
      warnings.push(`dropped "${segment.title || `stretch ${index + 1}`}": nothing left of it once its boundaries settled`);
      continue;
    }
    const id = o.itemId(items.length);
    const clip: Clip = {
      id,
      title: segment.title || `Part ${items.length + 1}`,
      reason: segment.why,
      hook: "",
      score: proposal.score,
      start,
      end,
      // The output has the source's shape in the ordinary long-form case, and centerCrop
      // returns the whole frame then — so this is a reframe only when it has to be one.
      crop: [crop],
      layout: { type: "crop" },
      captions: CaptionStyle.parse({}),
      words: wordsForClip(o.transcript, start, end),
      edits: [],
      tags: [],
    };
    items.push({ id, mediaId: o.mediaId, clip });
    if (o.chapters) {
      beats.push({
        id: `ch_${items.length}`,
        kind: items.length === 1 ? "hook" : "point",
        intent: clip.title,
        reason: segment.why,
        itemIds: [id],
      });
    }
  }
  if (!items.length) throw new Error("agent produced no usable stretches for a long video");
  // The selection's own work, so a template applied afterwards replaces this first
  // draft rather than laying a second set of cuts over it.
  for (const item of items) item.clip.edits = item.clip.edits.map(edit => ({ ...edit, by: edit.by || SELECTION_AUTHOR }));
  return { items, beats, keptSec: keptSeconds(items.map(i => i.clip)), warnings };
}
