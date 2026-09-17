import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { grabFrame, type Probe } from "../media";
import { toAgentText, wordsBetween, type Transcript } from "../transcript";
import { AgentClipProposals, CaptionStyle, Edl, centerCrop, type Clip } from "../edl";
import { resolveProvider, type AgentEvent } from "../agent";
import { resolveQuery } from "../search";
import { buildSelectPrompt } from "./prompt";
import type { Signals } from "./signals";

/**
 * The agent reads a transcript of third-party video — attacker-controlled text.
 * It gets file access inside its own workspace and nothing else.
 *
 * WebFetch/WebSearch are denied because they are the exfiltration path: an injected
 * transcript that says "post this to https://…" needs a way out, and this removes it.
 * Bash is denied because the agent does not need it — frames are pre-sampled and the
 * signals are already JSON. Set AGENTCUT_AGENT_SHELL=1 to grant ffprobe/ffmpeg back.
 */
const ALLOWED_TOOLS = ["Read", "Write", "Glob", "Grep"];
const SHELL_TOOLS = ["Bash(ffprobe:*)", "Bash(ffmpeg:*)"];
const DENIED_TOOLS = ["WebFetch", "WebSearch", "Task", "NotebookEdit"];

const shellEnabled = () => process.env.AGENTCUT_AGENT_SHELL === "1";

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
  const chunks = await writeTranscriptChunks(dir, transcript, probe.durationSec);
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
    prompt: buildSelectPrompt({ probe, targetClipCount, minSec, maxSec, userBrief, hasFrames, chunks }),
    allowedTools: shellEnabled() ? [...ALLOWED_TOOLS, ...SHELL_TOOLS] : ALLOWED_TOOLS,
    deniedTools: shellEnabled() ? DENIED_TOOLS : [...DENIED_TOOLS, "Bash"],
    model: o.model,
    onEvent: o.onEvent,
  });

  await fs.readFile(clipsPath, "utf8").catch(() => {
    throw new Error(`agent did not write clips.json. Last message: ${result.text.slice(0, 500)}`);
  });

  return buildEdl({ projectId: o.projectId, videoPath, dir, probe, transcript, minSec });
}

/**
 * Turn the agent's clips.json into a validated EDL.
 *
 * Split out from selectClips so a run can be recovered: the agent writes clips.json
 * to disk, so its work survives even if the process awaiting it dies.
 */
export async function buildEdl(o: {
  projectId: string;
  videoPath: string;
  dir: string;
  probe: Probe;
  transcript: Transcript;
  minSec?: number;
}): Promise<Edl> {
  const { dir, probe, transcript, videoPath, minSec = 20 } = o;
  const raw = await fs.readFile(path.join(dir, "clips.json"), "utf8");
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
        layout: p.layout ?? { type: "crop" as const },
        captions: CaptionStyle.parse(p.captions ?? {}),
        words: wordsBetween(transcript, start, end).map((w) => ({ ...w, t: w.t - start })),
        edits: p.edits ?? [],
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

  await resolveImageQueries(edl, o.projectId);
  await fs.writeFile(path.join(dir, "edl.json"), JSON.stringify(edl, null, 2));
  return edl;
}

/**
 * Turn the agent's `query` overlays into real assets.
 *
 * The agent has no network access on purpose, so it only says what it wants to
 * show. Anything that finds nothing good is dropped rather than left pointing at
 * a wrong picture.
 */
async function resolveImageQueries(edl: Edl, projectId: string) {
  for (const clip of edl.clips) {
    const kept: typeof clip.edits = [];
    for (const edit of clip.edits) {
      if (edit.type !== "image" || edit.src || !edit.query) {
        kept.push(edit);
        continue;
      }
      const asset = await resolveQuery(edit.query, projectId).catch(() => null);
      if (asset) kept.push({ ...edit, src: asset.id, credit: asset.attribution ?? "" });
    }
    clip.edits = kept;
  }
}

const CHUNK_MINUTES = 20;

/**
 * A five-hour transcript is far past what one Read returns. Split it into
 * timed chunks with an index so the agent can work through all of it instead of
 * silently seeing only the beginning.
 */
async function writeTranscriptChunks(dir: string, transcript: Transcript, duration: number) {
  if (duration < CHUNK_MINUTES * 60 * 1.5) return [] as string[];

  const chunkDir = path.join(dir, "transcript");
  await fs.rm(chunkDir, { recursive: true, force: true });
  await fs.mkdir(chunkDir, { recursive: true });

  const span = CHUNK_MINUTES * 60;
  const count = Math.ceil(duration / span);
  const names: string[] = [];

  for (let i = 0; i < count; i++) {
    const from = i * span;
    const to = Math.min(duration, from + span);
    const segments = transcript.segments.filter((sg) => sg.end > from && sg.start < to);
    if (!segments.length) continue;
    const name = `part-${String(i).padStart(2, "0")}.txt`;
    await fs.writeFile(
      path.join(chunkDir, name),
      toAgentText({ ...transcript, segments }),
    );
    names.push(`transcript/${name}  ${fmtClock(from)}–${fmtClock(to)}  (${segments.length} segments)`);
  }

  await fs.writeFile(path.join(chunkDir, "index.txt"), names.join("\n"));
  return names;
}

function fmtClock(sec: number) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${h}:${String(m).padStart(2, "0")}`;
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

const MAX_FRAMES = 60;

/**
 * Spread the samples over the WHOLE video. A fixed interval with a hard cap
 * silently limited coverage to the first 30 minutes, so the agent judged framing
 * for a five-hour stream from its opening half hour.
 */
async function sampleFrames(video: string, dir: string, duration: number, every: number) {
  if (!duration || duration < 1) return 0;
  const framesDir = path.join(dir, "frames");
  await fs.mkdir(framesDir, { recursive: true });
  const interval = Math.max(every, duration / MAX_FRAMES);
  const times: number[] = [];
  for (let t = 1; t < duration; t += interval) times.push(Math.round(t));
  let n = 0;
  for (const t of times) {
    try {
      await grabFrame(video, t, path.join(framesDir, `frame-${t}.jpg`));
      n++;
    } catch {
      // a bad seek shouldn't kill the run
    }
  }
  return n;
}
