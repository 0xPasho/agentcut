import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { projectDir } from "../config";
import type { Edl, VideoSequence } from "../edl";
import { sequenceFrames } from "../sequences";
import { openRenderServe } from "../render";
import { claimPidLock } from "./render";

/**
 * What the viewer sees, as stills the editing agent can open.
 *
 * ## Why this is not the footage
 *
 * The agent used to get frames grabbed straight out of the source files at the start
 * of each shot. Everything the editor actually does is invisible in those: captions,
 * titles, images, crops, split framing, layer transforms, the colour a dip passes
 * through, and every pixel a template placed. An agent asked to improve a video it
 * cannot see judges the raw footage and reports confidently on work that is not there.
 * So the frames come out of the same `SequenceComposition` that the Player previews
 * and the export writes — one renderer, one picture, three consumers.
 *
 * ## Why it is allowed to give up
 *
 * This runs *before* an agent turn, with a person waiting on the reply. A render is
 * seconds, not milliseconds, so the cost is the design: everything is cached against
 * what actually changes the picture, the work is capped in both frames and wall clock,
 * and every way of failing lands on the old source frames with the agent told, in
 * words, which of the two it is holding. Silently handing it source frames while the
 * prompt says "rendered output" would be worse than never building this.
 *
 * ## The lock
 *
 * This takes no `jobs` row. Sampling happens inside the edit job that already holds
 * the project, so a row of its own would either deadlock against the turn that needs
 * it or need the `background` status that automatic transcription uses (see
 * `src/lib/transcribe/auto.ts`) for work that genuinely outlives its caller. This
 * does not outlive anything: it is one step of a turn. What it does take is a
 * pid-named file lock, the same one exports use, and it never waits on it — a second
 * sampler, or an export already using the machine, means source frames this turn.
 */

/** Bump when the shape of a sampled set changes, so old cache directories are ignored. */
const VERSION = 1;

/**
 * 360 on the *short* side, capped at 640 on the long one.
 *
 * Decision 29 says "360p", which only names one number for a landscape video. A 1080×1920
 * output taken to 360 tall would be 202 wide — too small to read a caption in, which is the
 * whole point. Short-side 360 gives 640×360 landscape and 360×640 vertical: both are what
 * anyone means by 360p, both cost about the same, and text survives in either.
 */
const SHORT_SIDE = 360;

/** Decision 29's cadence. Widened, never narrowed, when a long video would blow the cap. */
const CADENCE_SEC = 2;

/**
 * At 2s this is 64s of video covered at full cadence; past that the cadence widens so the
 * whole video is still covered rather than the first minute of it. Chosen over "sample a
 * window": an agent that has seen 60s of a 4-minute video and believes it has seen the
 * video is exactly the confident-wrong failure this feature exists to remove. Coarser
 * degrades evenly; truncated does not.
 */
const MAX_FRAMES = 32;

/**
 * The whole sampling, wall clock, including the first bundle of the session. Past it the
 * frames rendered so far are kept and the rest are owed to the next turn. 40s is the
 * measured cost of a cold bundle plus a couple of dozen frames on this machine with room
 * to spare; it is only ever paid once per saved revision.
 */
const BUDGET_MS = 40_000;

const off = () => /^(0|off|false|no)$/i.test(process.env.AGENTCUT_OUTPUT_FRAMES ?? "");
const budgetMs = () => Number(process.env.AGENTCUT_OUTPUT_FRAMES_MS) || BUDGET_MS;
const cadenceSec = () => Number(process.env.AGENTCUT_OUTPUT_FRAMES_CADENCE) || CADENCE_SEC;
const maxFrames = () => Number(process.env.AGENTCUT_OUTPUT_FRAMES_MAX) || MAX_FRAMES;

/** Why there are no rendered frames this time, in words the agent is shown. */
export class NoOutputFrames extends Error {
  constructor(readonly reason: string, options?: { cause?: unknown }) {
    super(reason, options);
    this.name = "NoOutputFrames";
  }
}

export type OutputFrame = {
  /** Seconds into the finished video, which is what the file is named after. */
  outputSec: number;
  /** Absolute path in the project's cache. */
  file: string;
};

export type OutputFrameSet = {
  frames: OutputFrame[];
  width: number;
  height: number;
  /** Seconds between frames. Wider than the nominal 2s only when the cap forced it. */
  cadenceSec: number;
  durationSec: number;
  /** True when the budget ran out before every planned frame existed. */
  partial: boolean;
  /** How many frames the plan wanted, whether or not they all arrived. */
  planned: number;
  /** Nothing was rendered for this call: every frame came from the cache. */
  cached: boolean;
  ms: number;
  key: string;
};

/** What to sample and how big, decided before anything is rendered so it can be a cache key. */
export type Plan = {
  fps: number;
  durationFrames: number;
  durationSec: number;
  cadenceSec: number;
  scale: number;
  width: number;
  height: number;
  /** Composition frame numbers, ascending and distinct. */
  frames: number[];
};

export function framePlan(sequence: VideoSequence): Plan {
  const fps = sequence.output.fps;
  const durationFrames = sequenceFrames(sequence).duration;
  const durationSec = durationFrames / fps;
  const cap = maxFrames();
  // Half-second steps so the cadence a manifest reports is a number a person can hold.
  const widened = Math.ceil((durationSec / cap) * 2) / 2;
  const cadence = Math.max(cadenceSec(), widened);
  const frames: number[] = [];
  for (let t = 0; t < durationSec && frames.length < cap; t += cadence) {
    const frame = Math.min(Math.round(t * fps), durationFrames - 1);
    if (frames.at(-1) !== frame) frames.push(frame);
  }
  if (!frames.length) frames.push(0);
  // Never upscale: a 320×180 sequence is already smaller than the box.
  const scale = Math.min(1, SHORT_SIDE / Math.min(sequence.output.width, sequence.output.height));
  return {
    fps, durationFrames, durationSec, cadenceSec: cadence, scale, frames,
    width: Math.round(sequence.output.width * scale),
    height: Math.round(sequence.output.height * scale),
  };
}

/**
 * The cache key is the picture, not the revision.
 *
 * The saved revision is the obvious key and it is nearly right: it moves whenever
 * anything is saved, so it never serves a stale picture. It moves too eagerly, though —
 * renaming another video in the same project, or editing a second sequence, bumps it and
 * would throw away frames that still show exactly what the viewer sees. So the key is a
 * hash of everything the composition actually reads: this sequence, the media files it
 * points at, and the sampling itself. Anything that changes a pixel is in there, and a
 * turn that changed nothing renders nothing.
 *
 * Known limit, stated rather than hidden: an asset id whose bytes are replaced under it
 * keeps the same key. Nothing in the app rewrites an asset in place, and the revision
 * would not have caught it either.
 */
function cacheKey(edl: Edl, sequence: VideoSequence, p: Plan) {
  const used = new Set(sequence.items.map((i) => i.mediaId).filter((id): id is string => !!id));
  const media = (edl.media ?? []).filter((m) => used.has(m.id)).map((m) => [m.id, m.file]);
  return createHash("sha1")
    .update(JSON.stringify([VERSION, sequence, media, p.width, p.height, p.cadenceSec, p.frames]))
    .digest("hex")
    .slice(0, 16);
}

const frameFile = (dir: string, p: Plan, frame: number) =>
  path.join(dir, `frame-${(frame / p.fps).toFixed(1)}.jpg`);

/** One sampling per key per process, so two turns that want the same frames render once. */
declare global {
  var __agentcutOutputFrames: Map<string, Promise<OutputFrameSet>> | undefined;
}
const inFlight = (globalThis.__agentcutOutputFrames ??= new Map());

/**
 * Stills of the finished video at `sequence`'s own resolution and cadence.
 *
 * Throws `NoOutputFrames` — never anything else — when the caller should show source
 * frames instead. The snapshot is passed in rather than read again so the frames belong
 * to exactly the project state the turn is about to reason over.
 */
export async function outputFrames(projectId: string, edl: Edl, sequence: VideoSequence): Promise<OutputFrameSet> {
  if (off()) throw new NoOutputFrames("rendered frames are switched off on this machine (AGENTCUT_OUTPUT_FRAMES)");
  if (!sequence.items.length) throw new NoOutputFrames("this video has no shots in it yet, so there is nothing to render");
  const p = framePlan(sequence);
  const key = cacheKey(edl, sequence, p);
  const running = inFlight.get(key);
  if (running) return running;
  const work = sample(projectId, edl, sequence, p, key).finally(() => inFlight.delete(key));
  inFlight.set(key, work);
  return work;
}

async function sample(projectId: string, edl: Edl, sequence: VideoSequence, p: Plan, key: string): Promise<OutputFrameSet> {
  const started = Date.now();
  const root = path.join(projectDir(projectId), "output-frames");
  const dir = path.join(root, key);
  await fs.mkdir(dir, { recursive: true });

  const present = async () => {
    const have = new Set(await fs.readdir(dir).catch(() => [] as string[]));
    return p.frames.filter((f) => have.has(path.basename(frameFile(dir, p, f))));
  };
  let have = await present();
  const describe = (cached: boolean): OutputFrameSet => ({
    frames: have.map((f) => ({ outputSec: Number((f / p.fps).toFixed(1)), file: frameFile(dir, p, f) })),
    width: p.width, height: p.height, cadenceSec: p.cadenceSec, durationSec: p.durationSec,
    partial: have.length < p.frames.length, planned: p.frames.length,
    cached, ms: Date.now() - started, key,
  });

  // Everything already on disk: the turn changed nothing that shows, and this costs a readdir.
  if (have.length === p.frames.length) return describe(true);

  await browserReady();

  // Never waits. Somebody else rendering — an export, another turn, another process —
  // means this turn reads the footage instead of blocking a person behind a render.
  const lock = await claimPidLock(path.join(root, "sampling.lock"), "this video is already being rendered elsewhere")
    .catch((error: Error) => { throw new NoOutputFrames(error.message, { cause: error }); });
  try {
    // A second look after the lock: whoever held it may have rendered exactly these.
    have = await present();
    if (have.length === p.frames.length) return describe(true);
    const missing = p.frames.filter((f) => !have.includes(f));
    await renderInto(edl, sequence, p, dir, missing, budgetMs() - (Date.now() - started));
    have = await present();
  } finally {
    await lock.close();
    await fs.unlink(path.join(root, "sampling.lock")).catch(() => {});
  }
  if (!have.length) throw new NoOutputFrames(`the renderer finished no frames within ${Math.round(budgetMs() / 1000)}s`);
  await prune(root, dir);
  return describe(false);
}

/**
 * Render exactly the frames that are missing, and stop when the budget says so.
 *
 * A budget that expires is not a failure: Remotion writes each frame as it finishes, so
 * the ones already on disk stay, they are reported as a partial set, and the next turn
 * on the same picture renders only what is still owed. A slow machine converges instead
 * of paying the same doomed cost every turn.
 */
async function renderInto(edl: Edl, sequence: VideoSequence, p: Plan, dir: string, frames: number[], remainingMs: number) {
  if (remainingMs <= 0) return;
  const { selectComposition, renderFrames, makeCancelSignal } = await import("@remotion/renderer");
  const serve = await openRenderServe(edl, projectOf(edl));
  const inputProps = serve.sequenceProps(sequence);
  const scratch = path.join(dir, `.rendering-${process.pid}`);
  // Deliberately no `puppeteerInstance`: a browser passed in is a browser Remotion
  // only closes the *pages* of, leaving the process to the caller — and a caller
  // closing a browser whose render has just failed can wait forever, which turns a
  // failed sample into a hung turn. Letting each call own its own costs ~100ms and
  // is cleaned up by the same code path an export uses.
  const { cancelSignal, cancel } = makeCancelSignal();
  let cancelled = false;
  const timer = setTimeout(() => { cancelled = true; cancel(); }, Math.max(1, remainingMs));
  timer.unref?.();
  try {
    await fs.mkdir(scratch, { recursive: true });
    const composition = await selectComposition({
      serveUrl: serve.serveUrl, id: "VideoSequence", inputProps,
      logLevel: "error", timeoutInMilliseconds: Math.max(1000, remainingMs),
    });
    try {
      await renderFrames({
        composition: {
          ...composition,
          durationInFrames: p.durationFrames,
          fps: sequence.output.fps, width: sequence.output.width, height: sequence.output.height,
        },
        serveUrl: serve.serveUrl,
        inputProps,
        outputDir: scratch,
        // The explicit list keeps the real frame number in every filename, which is what
        // turns a file back into a moment of the finished video. `everyNthFrame` numbers
        // them from zero and loses that.
        frames,
        imageFormat: "jpeg",
        jpegQuality: 70,
        imageSequencePattern: "f-[frame].[ext]",
        scale: p.scale,
        // Deliberately below the export's default: a person may be exporting on the
        // same machine, and a sampler that starves the render they asked for is worse
        // than a sampler that takes a few seconds longer.
        concurrency: Math.max(1, Math.min(4, os.cpus().length - 1)),
        muted: true,
        logLevel: "error",
        // One frame may never take longer than the whole sampling is allowed to.
        timeoutInMilliseconds: Math.max(1000, remainingMs),
        cancelSignal,
        onStart: () => {},
        onFrameUpdate: () => {},
      });
    } catch (error) {
      // A cancelled render has still written everything it finished; anything else is real.
      if (!cancelled) throw error;
    }
    // Only now do the frames get their output-second names, so a half-written file is
    // never something the agent can open.
    for (const name of await fs.readdir(scratch).catch(() => [] as string[])) {
      const frame = /^f-(\d+)\.jpe?g$/.exec(name);
      if (!frame) continue;
      await fs.rename(path.join(scratch, name), frameFile(dir, p, Number(frame[1]))).catch(() => {});
    }
  } finally {
    clearTimeout(timer);
    await fs.rm(scratch, { recursive: true, force: true }).catch(() => {});
    await serve.close();
  }
}

const projectOf = (edl: Edl) => projectDir(edl.projectId);

/**
 * A machine that has never rendered has no browser, and Remotion's answer is to download
 * one — a hundred megabytes, which is not something to do to somebody who just asked for
 * a title to move. The download is started anyway and left to finish in the background,
 * so the next turn has output frames; this turn says why it does not.
 */
async function browserReady() {
  const { ensureBrowser } = await import("@remotion/renderer");
  let downloading = false;
  const ready = ensureBrowser({
    logLevel: "error",
    onBrowserDownload: () => { downloading = true; return { version: null, onProgress: () => {} }; },
  });
  ready.catch(() => {}); // it may outlive this turn; an unhandled rejection must not.
  await Promise.race([ready.catch(() => {}), new Promise((r) => setTimeout(r, 50))]);
  if (downloading) throw new NoOutputFrames("this machine is downloading the renderer's browser; the next turn will have output frames");
  await ready.catch((error: Error) => { throw new NoOutputFrames(`no browser to render with (${error.message})`, { cause: error }); });
}

/** Keep the current picture and the one before it; older keys are edits nobody can see any more. */
async function prune(root: string, keep: string) {
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  const dirs = entries.filter((e) => e.isDirectory() && path.join(root, e.name) !== keep);
  const dated = await Promise.all(dirs.map(async (e) => {
    const full = path.join(root, e.name);
    return { full, at: await fs.stat(full).then((s) => s.mtimeMs).catch(() => 0) };
  }));
  for (const stale of dated.sort((a, b) => b.at - a.at).slice(1)) await fs.rm(stale.full, { recursive: true, force: true }).catch(() => {});
}
