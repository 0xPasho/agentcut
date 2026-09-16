import fs from "node:fs/promises";
import path from "node:path";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { enableTailwind } from "@remotion/tailwind-v4";
import { serveDir } from "./fileServer";
import { WORKSPACE } from "./config";
import type { Edl, Clip } from "./edl";
import { buildTimeMap } from "./timeline";

const ENTRY = path.join(process.cwd(), "remotion", "index.ts");

export type RenderProgress = {
  clipId: string;
  title: string;
  index: number;
  total: number;
  /** 0..1 */
  progress: number;
  stage: "bundling" | "rendering" | "done";
};

let cachedBundle: string | null = null;

async function getBundle() {
  if (cachedBundle) return cachedBundle;
  cachedBundle = await bundle({
    entryPoint: ENTRY,
    publicDir: null,
    webpackOverride: enableTailwind,
  });
  return cachedBundle;
}

export async function renderClips(
  edl: Edl,
  dir: string,
  opts: { onProgress?: (p: RenderProgress) => void; only?: string[]; concurrency?: number } = {},
) {
  const outDir = path.join(dir, "clips");
  await fs.mkdir(outDir, { recursive: true });

  opts.onProgress?.({ clipId: "", title: "", index: 0, total: 0, progress: 0, stage: "bundling" });
  // Serve the whole workspace: the source and the project's assets/ directory are
  // both under it, and a source picked from elsewhere in the workspace still resolves.
  const [serveUrl, files] = await Promise.all([getBundle(), serveDir(WORKSPACE)]);
  const rel = (p: string) =>
    path
      .relative(WORKSPACE, path.resolve(p))
      .split(path.sep)
      .map(encodeURIComponent)
      .join("/");
  const sourceUrl = `${files.url}/${rel(edl.source.file)}`;
  const assetBase = `${files.url}/${rel(path.join(dir, "assets"))}/`;

  try {
  const clips = opts.only?.length ? edl.clips.filter((c) => opts.only!.includes(c.id)) : edl.clips;
  const outputs: Array<{ clip: Clip; file: string }> = [];

  for (const [index, clip] of clips.entries()) {
    const inputProps = {
      clip,
      sourceUrl,
      assetBase,
      sourceWidth: edl.source.width,
      sourceHeight: edl.source.height,
    };

    const composition = await selectComposition({ serveUrl, id: "Clip", inputProps });
    const outputLocation = path.join(outDir, `${clip.id}-${slug(clip.title)}.mp4`);

    await renderMedia({
      composition: {
        ...composition,
        durationInFrames: Math.max(1, Math.round(buildTimeMap(clip).duration * edl.output.fps)),
        fps: edl.output.fps,
        width: edl.output.width,
        height: edl.output.height,
      },
      serveUrl,
      codec: "h264",
      outputLocation,
      inputProps,
      concurrency: opts.concurrency,
      onProgress: ({ progress }) =>
        opts.onProgress?.({
          clipId: clip.id,
          title: clip.title,
          index,
          total: clips.length,
          progress,
          stage: "rendering",
        }),
    });

    outputs.push({ clip, file: outputLocation });
    opts.onProgress?.({
      clipId: clip.id,
      title: clip.title,
      index,
      total: clips.length,
      progress: 1,
      stage: "done",
    });
  }

  return outputs;
  } finally {
    await files.close();
  }
}

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "clip";
}
