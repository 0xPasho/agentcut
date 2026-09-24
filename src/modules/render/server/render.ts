import fs from "node:fs/promises";
import { rmSync } from "node:fs";
import path from "node:path";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { enableTailwind } from "@remotion/tailwind-v4";
import { serveDir } from "../../../common/server/file-server";
import { sequenceFrames } from "../../editor/lib/sequences";
import { WORKSPACE, ROOT } from "../../../common/server/config";
import type { Edl, Clip, VideoSequence } from "../../editor/types";
import { creditsFor } from "../../media/server/assets";
import { serverAssetUrls } from "../../media/server/asset-urls";
import { buildTimeMap, clipFrames } from "../../editor/lib/timeline";
import { conformSequences, sweepConform, type Conform } from "./conform";

const ENTRY = path.join(ROOT, "remotion", "index.ts");

/**
 * How long one frame may take to fetch and paint. A day, which is no limit in
 * practice: we would rather wait than lose an export, and there is no telling how
 * long a frame of somebody's project takes. A render that truly hangs now shows as
 * progress that stops, not as an error.
 *
 * What the first frame is actually waiting for is worth writing down, because it is
 * not a seek. `OffthreadVideo` does not stream: the first frame naming a source sends
 * Remotion's proxy to copy that *whole file* into its own temp directory before a
 * single pixel comes back (`assets/download-and-map-assets-to-file.js`), and its
 * downloader accepts nothing but `http(s)` — so serving the workspace over loopback,
 * which is the only way to hand it a multi-gigabyte recording at all, cannot avoid the
 * copy. A five-hour capture is tens of gigabytes and the copy is minutes, all of it
 * charged to frame one, which is why the 28-second default could never have held.
 *
 * The copy is cached per source for the rest of the render, so it is paid once and
 * then forgotten. Paying it at all is the waste: a 26-minute export copies five hours
 * of footage to read 26 minutes of it. Cutting each item's span out with ffmpeg first
 * and pointing the composition at those — leaving the EDL untouched — is the fix this
 * timeout is standing in for.
 */
const FRAME_TIMEOUT_MS = 24 * 60 * 60 * 1000;

export type RenderProgress = {
  clipId: string;
  title: string;
  index: number;
  total: number;
  /** 0..1 */
  progress: number;
  stage: "preparing" | "bundling" | "rendering" | "done";
};

let cachedBundle: Promise<string> | null = null;

/**
 * The bundle is written to a fresh temporary directory and nobody was removing it.
 *
 * One per process that renders anything — the server, the CLI, a test — about thirty
 * megabytes each, kept until the operating system decides to sweep its temp folder,
 * which on a Mac can be never. A day of restarting a dev server and running the render
 * tests left three hundred and fifty of them on this machine: ten gigabytes of webpack
 * output for a bundle that is rebuilt every time anyway.
 *
 * Removed when this process ends. Best effort by nature — a process that is killed
 * outright leaves its directory behind — and safe because the directory belongs to this
 * process alone, which is the whole reason `enableCaching` is off.
 */
function removeWhenThisProcessEnds(dir: string) {
  const sweep = () => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* the temp folder is not ours to insist on */ } };
  process.once("exit", sweep);
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => { sweep(); process.exit(0); });
}

export async function getBundle() {
  if (cachedBundle) return cachedBundle;
  cachedBundle = bundle({
    entryPoint: ENTRY,
    publicDir: null,
    // CLI and web processes may bundle concurrently. Reuse the finished in-process
    // bundle, but do not let independent renderers share a mutable disk cache.
    enableCaching: false,
    webpackOverride: enableTailwind,
  }).then((dir) => { removeWhenThisProcessEnds(dir); return dir; })
    .catch(error => { cachedBundle = null; throw error; });
  return cachedBundle;
}

/**
 * The bundle, the loopback file server and every URL a composition of this EDL
 * needs, opened once.
 *
 * Exports are not the only thing that renders this project: the editing agent
 * samples the finished video into stills before a turn. Both go through here, so
 * there is exactly one place that decides how a source, a piece of media and an
 * asset become URLs — a second answer to that question is a second renderer, and
 * the two would drift into showing different videos.
 */
export type RenderServe = {
  serveUrl: string;
  /** Props for the `VideoSequence` composition — the same object the export passes. */
  sequenceProps: (sequence: VideoSequence) => Record<string, unknown>;
  /** Props for the legacy single-source `Clip` composition. */
  clipProps: (clip: Clip) => Record<string, unknown>;
  close: () => Promise<void>;
};

export async function openRenderServe(edl: Edl, dir: string, conform: Conform | null = null): Promise<RenderServe> {
  // Serve the whole workspace: the source and the project's assets/ directory are
  // both under it, and a source picked from elsewhere in the workspace still resolves.
  const [serveUrl, files] = await Promise.all([getBundle(), serveDir(WORKSPACE, {
    // Only a project that has a primary source gets an alias for it.
    ...(edl.source ? { "/__primary_source": edl.source.file } : {}),
    ...Object.fromEntries((edl.media ?? []).map(m => [`/__media/${m.id}`, m.file])),
    // A conformed render reads cuts of those sources instead, under names of their own.
    ...Object.fromEntries(Object.entries(conform?.files ?? {}).map(([id, file]) => [`/__media/${id}`, file])),
  })]);
  const rel = (p: string) =>
    path
      .relative(WORKSPACE, path.resolve(p))
      .split(path.sep)
      .map(encodeURIComponent)
      .join("/");
  const sourceUrl = edl.source ? `${files.url}/__primary_source` : "";
  const assetBase = `${files.url}/${rel(path.join(dir, "assets"))}/`;
  const assetUrls = serverAssetUrls(edl, edl.projectId, files.url);
  const mediaUrls = Object.fromEntries([...(edl.media ?? []), ...(conform?.media ?? [])].map(m => [m.id, `${files.url}/__media/${m.id}`]));
  const media = conform ? [...(edl.media ?? []), ...conform.media] : edl.media;
  return {
    serveUrl,
    // The cuts stand in for the recordings only in what this render is handed. The EDL
    // itself is untouched, which is why the rewrite lives here and not in the store.
    sequenceProps: (sequence) => ({ sequence: conform ? conform.rewrite(sequence) : sequence, media, mediaUrls, assetBase, assetUrls }),
    clipProps: (clip) => ({
      clip, sourceUrl, assetBase, assetUrls,
      sourceWidth: edl.source!.width, sourceHeight: edl.source!.height,
    }),
    close: () => files.close(),
  };
}

export async function renderClips(
  edl: Edl,
  dir: string,
  opts: { onProgress?: (p: RenderProgress) => void; only?: string[]; concurrency?: number; conformMinBytes?: number } = {},
) {
  const outDir = path.join(dir, "clips");
  await fs.mkdir(outDir, { recursive: true });

  const all = [...edl.clips, ...(edl.sequences ?? [])];
  const clips = opts.only?.length ? all.filter((c) => opts.only!.includes(c.id)) : all;

  // Cut the parts of each recording this render plays out of it first, so Remotion copies
  // and seeks in minutes of footage rather than hours. Nothing is conformed unless it
  // pays for itself, and a failure here is not a failed export: the render falls back to
  // the sources themselves, which is how every render worked before this.
  const sequences = clips.filter((clip): clip is VideoSequence => "items" in clip);
  const conform = await conformSequences(edl, dir, sequences, {
    minBytes: opts.conformMinBytes,
    onProgress: (done, total) => opts.onProgress?.({ clipId: "", title: "", index: done, total, progress: total ? done / total : 0, stage: "preparing" }),
  }).catch(() => null);

  opts.onProgress?.({ clipId: "", title: "", index: 0, total: 0, progress: 0, stage: "bundling" });
  const serve = await openRenderServe(edl, dir, conform);
  const { serveUrl } = serve;

  try {
  const outputs: Array<{ clip: { id: string; title: string }; file: string }> = [];

  for (const [index, clip] of clips.entries()) {
    const sequence = "items" in clip ? clip : null;
    if (sequence && !sequence.items.length) throw new Error(`Add a scene to “${sequence.title}” before exporting`);
    if (!sequence && !edl.source) throw new Error(`“${clip.title}” is cut from a source video this project does not have`);
    const output = sequence?.output ?? edl.output;
    const inputProps = sequence ? serve.sequenceProps(sequence) : serve.clipProps(clip as Clip);

    const composition = await selectComposition({ serveUrl, id: sequence ? "VideoSequence" : "Clip", inputProps, timeoutInMilliseconds: FRAME_TIMEOUT_MS });
    const outputLocation = path.join(outDir, `${clip.id}-${slug(clip.title)}.mp4`);

    await renderMedia({
      composition: {
        ...composition,
        durationInFrames: sequence ? sequenceFrames(sequence).duration : clipFrames(buildTimeMap(clip as Clip), output.fps),
        fps: output.fps,
        width: output.width,
        height: output.height,
      },
      serveUrl,
      codec: "h264",
      outputLocation,
      inputProps,
      concurrency: opts.concurrency,
      timeoutInMilliseconds: FRAME_TIMEOUT_MS,
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

  await writeCredits(edl, outDir);
  await sweepConform(dir);
  return outputs;
  } finally {
    await serve.close();
  }
}

/** CREDITS.txt next to the clips — the only place the licence obligation can be met. */
async function writeCredits(edl: Edl, outDir: string) {
  const refs = [...edl.clips, ...(edl.sequences ?? []).flatMap(s => s.items.map(i => i.clip))].flatMap((c) =>
    c.edits.filter((e) => e.type === "image").map((e) => (e as { src: string }).src),
  );
  const lines = creditsFor(refs);
  const file = path.join(outDir, "CREDITS.txt");
  if (!lines.length) return void (await fs.rm(file, { force: true }));
  await fs.writeFile(
    file,
    ["Images used in these clips require the credits below.", "", ...lines.map((l) => `- ${l}`), ""].join("\n"),
  );
}

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "clip";
}
