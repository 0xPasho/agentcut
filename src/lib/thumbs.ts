import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { projectDir } from "./config";
import { FFMPEG, run } from "./bin";
import type { Clip, Edl } from "./edl";

/** Enough of a source to seek into it and know how its pixels are laid out. */
export type ThumbSource = { file: string; width: number; height: number };
/** The frame the poster has to fill. A 9:16 poster on a 16:9 video is a lie. */
export type ThumbOutput = { width: number; height: number };

/** What the poster for `id` is taken from, whether that is a generated clip or a timeline. */
export function thumbTarget(
  edl: Edl,
  id: string,
): { source: ThumbSource; clip: Clip; output: ThumbOutput } | null {
  const clip = edl.clips.find((c) => c.id === id);
  if (clip) return edl.source ? { source: edl.source, clip, output: edl.output } : null;

  const sequence = edl.sequences.find((s) => s.id === id);
  if (!sequence) return null;
  // The first shot with footage behind it, not simply the first shot: a title card
  // opener would render as a black rectangle and tell you nothing about the video.
  for (const item of sequence.items) {
    const source = item.mediaId === null ? null : edl.media.find((m) => m.id === item.mediaId);
    if (source) return { source, clip: item.clip, output: sequence.output };
  }
  return null;
}

/**
 * Poster frame for a clip, cropped the way the clip will actually be framed —
 * a thumbnail of the uncropped source would misrepresent a split-screen clip.
 * Cached on disk: a seek into a multi-gigabyte source is not something to repeat
 * on every render of the list.
 *
 * The cache key carries the framing, so a trim or a re-crop gets its own file
 * rather than serving the poster of an edit the user has already moved past.
 */
export async function clipThumb(
  projectId: string,
  source: ThumbSource,
  clip: Clip,
  output: ThumbOutput,
): Promise<string> {
  const dir = path.join(projectDir(projectId), "thumbs");
  await fs.mkdir(dir, { recursive: true });
  const size = posterSize(output);
  const key = createHash("sha1")
    .update(JSON.stringify([source.file, source.width, source.height, clip.start, clip.end, clip.crop, clip.layout, size]))
    .digest("hex")
    .slice(0, 12);
  const file = path.join(dir, `${clip.id}-${key}.jpg`);

  const cached = await fs.stat(file).catch(() => null);
  if (cached && cached.size > 0) return file;

  // A second in, rather than the very first frame, which is often a cut.
  const at = Math.min(clip.start + 1, clip.end - 0.2);
  const filter = buildFilter(source, clip, size);

  await run(FFMPEG, [
    "-y",
    "-ss", String(at),
    "-i", source.file,
    "-frames:v", "1",
    "-vf", filter,
    "-q:v", "5",
    file,
  ]);

  return file;
}

/** The output aspect, fitted into a 480px box and kept even for the encoder. */
function posterSize(output: ThumbOutput): { w: number; h: number } {
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  return output.width >= output.height
    ? { w: 480, h: even((480 * output.height) / output.width) }
    : { w: even((480 * output.width) / output.height), h: 480 };
}

function rect(x: number, y: number, w: number, h: number) {
  const round = (n: number) => Math.max(2, Math.round(n));
  return `crop=${round(w)}:${round(h)}:${round(x)}:${round(y)}`;
}

/**
 * One region of a source, cropped and scaled to fill a box exactly the way the renderer
 * fills it. Exported because a poster is not the only thing that has to agree with the
 * renderer about what a layout means: `scripts/style-audit.ts` rebuilds a finished
 * video's panes from its source and compares them pixel for pixel.
 */
export function regionFilter(
  region: { x: number; y: number; w: number; h: number },
  box: { width: number; height: number },
): string {
  return `${rect(region.x, region.y, region.w, region.h)},scale=${box.width}:${box.height}:force_original_aspect_ratio=increase,crop=${box.width}:${box.height}`;
}

function buildFilter(source: ThumbSource, clip: Clip, { w: W, h: H }: { w: number; h: number }): string {
  if (clip.layout.type === "split") {
    const topH = Math.round((H * clip.layout.topPct) / 100);
    const t = clip.layout.top;
    const b = clip.layout.bottom;
    return (
      `[0:v]split=2[a][b];` +
      `[a]${regionFilter(t, { width: W, height: topH })}[top];` +
      `[b]${regionFilter(b, { width: W, height: H - topH })}[bot];` +
      `[top][bot]vstack=inputs=2`
    );
  }

  const c = clip.crop[0] ?? { x: 0, y: 0, w: source.width, h: source.height };
  return `${rect(c.x, c.y, c.w, c.h)},scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}`;
}
