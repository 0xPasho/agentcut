import fs from "node:fs/promises";
import path from "node:path";
import { projectDir } from "./config";
import { FFMPEG, run } from "./bin";
import type { Clip, Edl } from "./edl";

/**
 * Poster frame for a clip, cropped the way the clip will actually be framed —
 * a thumbnail of the uncropped source would misrepresent a split-screen clip.
 * Cached on disk: a seek into a multi-gigabyte source is not something to repeat
 * on every render of the list.
 */
export async function clipThumb(projectId: string, edl: Edl, clip: Clip): Promise<string> {
  const dir = path.join(projectDir(projectId), "thumbs");
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${clip.id}.jpg`);

  const cached = await fs.stat(file).catch(() => null);
  if (cached && cached.size > 0) return file;

  // A second in, rather than the very first frame, which is often a cut.
  const at = Math.min(clip.start + 1, clip.end - 0.2);
  const filter = buildFilter(edl, clip);

  await run(FFMPEG, [
    "-y",
    "-ss", String(at),
    "-i", edl.source.file,
    "-frames:v", "1",
    "-vf", filter,
    "-q:v", "5",
    file,
  ]);

  return file;
}

function rect(x: number, y: number, w: number, h: number) {
  const round = (n: number) => Math.max(2, Math.round(n));
  return `crop=${round(w)}:${round(h)}:${round(x)}:${round(y)}`;
}

function buildFilter(edl: Edl, clip: Clip): string {
  const W = 270;
  const H = 480;

  if (clip.layout.type === "split") {
    const topH = Math.round((H * clip.layout.topPct) / 100);
    const t = clip.layout.top;
    const b = clip.layout.bottom;
    return (
      `[0:v]split=2[a][b];` +
      `[a]${rect(t.x, t.y, t.w, t.h)},scale=${W}:${topH}:force_original_aspect_ratio=increase,crop=${W}:${topH}[top];` +
      `[b]${rect(b.x, b.y, b.w, b.h)},scale=${W}:${H - topH}:force_original_aspect_ratio=increase,crop=${W}:${H - topH}[bot];` +
      `[top][bot]vstack=inputs=2`
    );
  }

  const c = clip.crop[0] ?? { x: 0, y: 0, w: edl.source.width, h: edl.source.height };
  return `${rect(c.x, c.y, c.w, c.h)},scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}`;
}
