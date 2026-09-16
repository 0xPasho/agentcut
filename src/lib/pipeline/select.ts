import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { grabFrame, type Probe } from "../media";
import { toAgentText, wordsBetween, type Transcript } from "../transcript";
import { AgentClipProposals, CaptionStyle, Edl, centerCrop, type Clip } from "../edl";
import { resolveProvider, type AgentEvent } from "../agent";
import { buildSelectPrompt } from "./prompt";
import type { Signals } from "./signals";

/** The agent may read and write inside its own workspace, and probe the media. Nothing else. */
const ALLOWED_TOOLS = [
  "Read",
  "Write",
  "Glob",
  "Grep",
  "Bash(ffprobe:*)",
  "Bash(ffmpeg:*)",
  "Bash(jq:*)",
];

export type SelectOptions = {
  projectId: string;
  videoPath: string;
  dir: string;
  probe: Probe;
  transcript: Transcript;
  signals: Signals;
  targetClipCount?: number;
  minSec?: number;
  maxSec?: number;
  userBrief?: string;
  frameEvery?: number;
  provider?: string;
  model?: string;
  onEvent?: (e: AgentEvent) => void;
};

export async function selectClips(o: SelectOptions): Promise<Edl> {
  const {
    dir, probe, transcript, signals, videoPath,
    targetClipCount = 6, minSec = 20, maxSec = 75,
    userBrief = "", frameEvery = 30,
  } = o;

  await fs.mkdir(dir, { recursive: true });
  await Promise.all([
    fs.writeFile(path.join(dir, "transcript.txt"), toAgentText(transcript)),
    fs.writeFile(path.join(dir, "transcript.json"), JSON.stringify(transcript)),
    fs.writeFile(path.join(dir, "signals.json"), JSON.stringify(signals, null, 2)),
    fs.writeFile(path.join(dir, "source.json"), JSON.stringify(probe, null, 2)),
  ]);

  const hasFrames = await sampleFrames(videoPath, dir, probe.durationSec, frameEvery)
    .then((n) => n > 0)
    .catch(() => false);

  // A stale clips.json from a previous run would silently pass validation.
  const clipsPath = path.join(dir, "clips.json");
  await fs.rm(clipsPath, { force: true });

  const provider = await resolveProvider(o.provider);
  const result = await provider.run({
    cwd: dir,
    prompt: buildSelectPrompt({ probe, targetClipCount, minSec, maxSec, userBrief, hasFrames }),
    allowedTools: ALLOWED_TOOLS,
    model: o.model,
    onEvent: o.onEvent,
  });

  const raw = await fs.readFile(clipsPath, "utf8").catch(() => {
    throw new Error(`agent did not write clips.json. Last message: ${result.text.slice(0, 500)}`);
  });

  const proposals = AgentClipProposals.parse(JSON.parse(raw));
  const fallbackCrop = centerCrop(probe.width, probe.height, 1080, 1920);

  const clips: Clip[] = proposals.clips
    .map((p) => {
      const [start, end] = snapToWords(transcript, p.start, p.end, probe.durationSec);
      return {
        id: randomUUID().slice(0, 8),
        title: p.title,
        hook: p.hook,
        reason: p.reason,
        score: p.score,
        start,
        end,
        crop: p.crop.length ? p.crop : [fallbackCrop],
        captions: CaptionStyle.parse(p.captions ?? {}),
        words: wordsBetween(transcript, start, end).map((w) => ({ ...w, t: w.t - start })),
      };
    })
    .filter((c) => c.end - c.start >= Math.min(5, minSec))
    .sort((a, b) => b.score - a.score);

  if (!clips.length) throw new Error("agent produced no usable clips");

  const edl = Edl.parse({
    version: 1,
    projectId: o.projectId,
    source: {
      file: videoPath,
      width: probe.width,
      height: probe.height,
      fps: probe.fps,
      durationSec: probe.durationSec,
    },
    clips,
  });

  await fs.writeFile(path.join(dir, "edl.json"), JSON.stringify(edl, null, 2));
  return edl;
}

/**
 * Agents routinely land a boundary a few hundred ms inside a word. Snapping is
 * deterministic and fixes it without another round trip.
 */
function snapToWords(t: Transcript, start: number, end: number, duration: number): [number, number] {
  let s = Math.max(0, Math.min(start, duration));
  let e = Math.max(s + 1, Math.min(end, duration));

  const straddlingStart = t.words.find((w) => w.t < s && w.t + w.d > s + 0.05);
  if (straddlingStart) s = straddlingStart.t;

  const straddlingEnd = t.words.find((w) => w.t < e - 0.05 && w.t + w.d > e);
  if (straddlingEnd) e = straddlingEnd.t + straddlingEnd.d;

  return [Number(s.toFixed(3)), Number(e.toFixed(3))];
}

async function sampleFrames(video: string, dir: string, duration: number, every: number) {
  if (!duration || duration < 1) return 0;
  const framesDir = path.join(dir, "frames");
  await fs.mkdir(framesDir, { recursive: true });
  const times: number[] = [];
  for (let t = 1; t < duration; t += every) times.push(Math.round(t));
  const capped = times.slice(0, 60);
  let n = 0;
  for (const t of capped) {
    try {
      await grabFrame(video, t, path.join(framesDir, `frame-${t}.jpg`));
      n++;
    } catch {
      // a bad seek shouldn't kill the run
    }
  }
  return n;
}
