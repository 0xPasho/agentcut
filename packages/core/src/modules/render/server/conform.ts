import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { FFMPEG, run } from "../../../common/server/bin";
import type { Edl, MediaSource, VideoSequence } from "../../editor/types";

/**
 * Cutting the parts of a recording a render actually uses out of it, first.
 *
 * `OffthreadVideo` does not stream. The first frame naming a source sends Remotion's
 * proxy to copy that *whole file* into its temp directory before a single pixel comes
 * back, and its downloader takes nothing but `http(s)` — so serving the workspace over
 * loopback, the only way to hand it a multi-gigabyte recording at all, cannot avoid the
 * copy. A 26-minute video cut from a five-hour stream copies five hours to read 26
 * minutes of them, and every frame after that seeks into a file that size.
 *
 * So the spans the timeline actually plays are cut out with ffmpeg first, and the
 * composition is pointed at those. Nothing here touches the project: the EDL is the
 * authority and is never rewritten, only the props handed to one render are, and a
 * shot's own times are moved by exactly the amount its footage moved. Everything else
 * about a clip — the crop in source pixels, its words and edits in clip-relative
 * seconds — is measured from the shot's own start and needs no adjusting at all.
 */

/** Gap below which two spans of one source are cut as one piece rather than two files. */
const MERGE_GAP_SEC = 10;
/** Extra footage kept either side, so a rounding error never lands past the end of a cut. */
const PAD_SEC = 0.25;
/**
 * Below this a source is not worth conforming: the copy Remotion makes of it is quick,
 * and an ffmpeg pass to save a quick copy is a slower render, not a faster one.
 */
export const CONFORM_MIN_BYTES = 256 * 1024 * 1024;
/**
 * And above this share of a source there is nothing to cut away. Re-encoding nine
 * tenths of a recording to skip one tenth costs more than the tenth is worth.
 */
const CONFORM_MAX_SHARE = 0.8;

export type ConformOptions = {
  /** Lowered by tests, which cannot afford a gigabyte of fixture to exercise this. */
  minBytes?: number;
  /** Told about each cut as it is made, so a long preparation is not a silent one. */
  onProgress?: (done: number, total: number) => void;
};

/** What the composition should be handed instead of the project's own sources. */
export type Conform = {
  /** The sources the composition sees: one per cut, standing in for the recording it came from. */
  media: MediaSource[];
  /** Absolute paths, for whoever is serving them. */
  files: Record<string, string>;
  /** A sequence whose shots point at the cut holding them, at times measured from its start. */
  rewrite: (sequence: VideoSequence) => VideoSequence;
};

type Span = { from: number; to: number };

/** The stretches of one source a set of sequences plays, merged where they nearly meet. */
export function usedSpans(sequences: VideoSequence[], mediaId: string, durationSec: number): Span[] {
  const raw = sequences
    .flatMap(sequence => sequence.items)
    .filter(item => item.mediaId === mediaId)
    .map(item => ({
      from: Math.max(0, item.clip.start - PAD_SEC),
      to: Math.min(durationSec, item.clip.end + PAD_SEC),
    }))
    .filter(span => span.to > span.from)
    .sort((a, b) => a.from - b.from);
  const merged: Span[] = [];
  for (const span of raw) {
    const last = merged[merged.length - 1];
    if (last && span.from - last.to <= MERGE_GAP_SEC) last.to = Math.max(last.to, span.to);
    else merged.push({ ...span });
  }
  return merged;
}

/** A name that changes when the source does, so a re-ingested recording is never reused stale. */
const cutName = (mediaId: string, span: Span, stamp: string) =>
  `${mediaId}-${createHash("sha1").update(`${stamp}|${span.from}|${span.to}`).digest("hex").slice(0, 12)}.mp4`;

/**
 * Exactly the asked-for seconds, re-encoded rather than copied.
 *
 * `-c copy` would be instant and would start at the keyframe before the cut instead of
 * at the cut, leaving an offset nothing downstream could learn without probing the
 * result. Re-encoding with the seek ahead of the input starts on the frame asked for, so
 * the offset is the number we passed in and every shot's times move by exactly it. It
 * also lays down a keyframe a second, which is what makes extracting frames out of the
 * result quick — the second half of the problem this exists for.
 */
async function cut(source: string, span: Span, fps: number, dest: string) {
  const partial = `${dest}.partial.mp4`;
  await run(FFMPEG, [
    "-y", "-ss", String(span.from), "-i", source, "-t", String(span.to - span.from),
    "-map", "0:v:0", "-map", "0:a:0?",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
    "-g", String(Math.max(1, Math.round(fps))),
    "-c:a", "aac", "-b:a", "192k",
    partial,
  ]);
  await fs.rename(partial, dest);
}

/**
 * Cut what these sequences play out of the sources they play it from, reusing anything
 * already cut. `null` when none of it was worth doing, which is the ordinary answer for
 * a project of ordinary files and leaves the render exactly as it was.
 */
export async function conformSequences(
  edl: Edl,
  dir: string,
  sequences: VideoSequence[],
  options: ConformOptions = {},
): Promise<Conform | null> {
  const minBytes = options.minBytes ?? CONFORM_MIN_BYTES;
  const used = new Set(sequences.flatMap(sequence => sequence.items.map(item => item.mediaId)).filter((id): id is string => !!id));
  const plan: Array<{ source: MediaSource; span: Span; id: string; file: string }> = [];

  for (const source of edl.media ?? []) {
    if (!used.has(source.id)) continue;
    const stat = await fs.stat(source.file).catch(() => null);
    if (!stat || stat.size < minBytes) continue;
    const spans = usedSpans(sequences, source.id, source.durationSec);
    const kept = spans.reduce((total, span) => total + (span.to - span.from), 0);
    if (!spans.length || kept > source.durationSec * CONFORM_MAX_SHARE) continue;
    const stamp = `${stat.size}-${Math.floor(stat.mtimeMs)}`;
    for (const [index, span] of spans.entries()) {
      plan.push({
        source, span,
        id: `${source.id}__c${index}`,
        file: path.join(dir, "conform", cutName(source.id, span, stamp)),
      });
    }
  }
  if (!plan.length) return null;

  await fs.mkdir(path.join(dir, "conform"), { recursive: true });
  let done = 0;
  for (const entry of plan) {
    options.onProgress?.(done, plan.length);
    // Anything already on disk under this name is this exact span of this exact file.
    if (!(await fs.stat(entry.file).catch(() => null))) await cut(entry.source.file, entry.span, entry.source.fps, entry.file);
    else await fs.utimes(entry.file, new Date(), new Date()).catch(() => {});
    done += 1;
  }
  options.onProgress?.(done, plan.length);

  const media: MediaSource[] = plan.map(entry => ({
    ...entry.source,
    id: entry.id,
    file: entry.file,
    durationSec: entry.span.to - entry.span.from,
    // A cut is not a source anybody imported, and it has no words of its own to speak of.
    transcription: undefined,
  }));
  const files = Object.fromEntries(plan.map(entry => [entry.id, entry.file]));

  const rewrite = (sequence: VideoSequence): VideoSequence => ({
    ...sequence,
    items: sequence.items.map(item => {
      if (!item.mediaId) return item;
      // The cut that holds this whole shot. There is always one: the spans were built
      // from these very shots, and a merge only ever makes them longer.
      const entry = plan.find(candidate => candidate.source.id === item.mediaId
        && candidate.span.from <= item.clip.start + 1e-6 && candidate.span.to >= item.clip.end - 1e-6);
      if (!entry) return item;
      return { ...item, mediaId: entry.id, clip: { ...item.clip, start: item.clip.start - entry.span.from, end: item.clip.end - entry.span.from } };
    }),
  });
  return { media, files, rewrite };
}

/** How long a cut may sit unused before the next render throws it away. */
const KEEP_MS = 24 * 60 * 60 * 1000;

/** Forget the cuts nothing has asked for in a day. Best effort: a full disk is not a failed render. */
export async function sweepConform(dir: string) {
  const folder = path.join(dir, "conform");
  const names = await fs.readdir(folder).catch(() => [] as string[]);
  const cutoff = Date.now() - KEEP_MS;
  for (const name of names) {
    const file = path.join(folder, name);
    const stat = await fs.stat(file).catch(() => null);
    if (stat && stat.mtimeMs < cutoff) await fs.rm(file, { force: true }).catch(() => {});
  }
}
