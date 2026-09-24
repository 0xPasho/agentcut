import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { grabFrame, type Probe } from "../../media/server/ffmpeg";
import { toAgentText, wordsForClip, type Transcript } from "../../transcription/lib/transcript";
import { AgentClipProposals, CaptionStyle, Edl, centerCrop, type Clip, SELECTION_AUTHOR } from "../../editor/types";
import { resolveProvider, type AgentEvent } from "../../agent/server/providers";
import { trim } from "../../editor/lib/operations";
import { resolveQuery } from "../../media/server/search";
import { buildSelectPrompt } from "../lib/prompt";
import { runtime } from "../../../common/lib/format";
import { tightenBoundaries } from "../lib/boundaries";
import { keptSeconds, sectionTimeline } from "../lib/section";
import { AgentSectionProposals, SelectionSpec } from "../types";
import { emptySequencePlan } from "../../plan/types";
import type { Signals } from "./signals";
import { listRules } from "../../rules/server/registry";
import { candidateRules } from "../../rules/server/evaluate";
import { readPreferences, preferencesBlock } from "../../rules/server/preferences";
import { readGlossary, glossaryBrief } from "../../rules/server/glossary";
import { AGENT_DENIED_TOOLS } from "../../agent/data";

/** Where buildEdl leaves the agent's per-clip rule matches for the host to execute after publishing. */
export const ruleMatchesFile = (dir: string) => path.join(dir, "rule-matches.json");
export async function readRuleMatches(dir: string): Promise<Record<string, string[]>> {
  try { return JSON.parse(await fs.readFile(ruleMatchesFile(dir), "utf8")); } catch { return {}; }
}

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
const DENIED_TOOLS = AGENT_DENIED_TOOLS;

const shellEnabled = () => process.env.AGENTCUT_AGENT_SHELL === "1";

export type SelectOptions = {
  projectId: string;
  videoPath: string;
  dir: string;
  probe: Probe;
  transcript: Transcript;
  signals: Signals;
  /**
   * What to choose and in what shape, from the template the project is made in. Its
   * `mode` decides whether this run proposes a pack of clips or one long video, so it
   * is the one option that changes what comes back.
   */
  selection: SelectionSpec;
  userBrief?: string;
  frameEvery?: number;
  provider?: string;
  model?: string;
  onEvent?: (e: AgentEvent) => void;
};

export async function selectClips(o: SelectOptions): Promise<Edl> {
  const {
    dir, probe, transcript, signals, videoPath,
    selection: spec, userBrief = "", frameEvery = 30,
  } = o;

  await fs.mkdir(dir, { recursive: true });
  const chunks = await writeTranscriptChunks(dir, transcript, probe.durationSec);
  // The owner's rules, preferences and glossary travel with the material. Rules are
  // judged here, not executed: the host runs the matched ones after publishing.
  const allRules = await listRules(o.projectId);
  const selectRules = candidateRules(allRules, "select").map((r) => ({ id: r.id, when: r.when, prompt: r.promptText.trim() }));
  const editRules = candidateRules(allRules, "edit").map((r) => ({ id: r.id, name: r.name, when: r.when }));
  const preferences = preferencesBlock(await readPreferences(o.projectId));
  const glossary = await readGlossary(o.projectId);
  // Which moments are worth a clip is the style guide's first question.
  const { styleForRun } = await import("../../packs/server/style");
  const style = await styleForRun(o.projectId, dir).catch(() => "");
  await Promise.all([
    fs.writeFile(path.join(dir, "transcript.txt"), toAgentText(transcript)),
    fs.writeFile(path.join(dir, "transcript.json"), JSON.stringify(transcript)),
    fs.writeFile(path.join(dir, "signals.json"), JSON.stringify(signals, null, 2)),
    fs.writeFile(path.join(dir, "source.json"), JSON.stringify(probe, null, 2)),
    fs.writeFile(path.join(dir, "rules.json"), JSON.stringify(allRules.filter((r) => r.enabled).map(({ id, name, when, stage, priority, description }) => ({ id, name, when, stage, priority, description })), null, 2)),
    fs.writeFile(path.join(dir, "glossary.json"), JSON.stringify(glossary, null, 2)),
    fs.writeFile(path.join(dir, "preferences.md"), preferences),
  ]);

  const hasFrames = await sampleFrames(videoPath, dir, probe.durationSec, frameEvery)
    .then((n) => n > 0)
    .catch(() => false);

  // A stale answer from a previous run would silently pass validation.
  const answerName = spec.mode === "section" ? "video.json" : "clips.json";
  const answerPath = path.join(dir, answerName);
  await fs.rm(answerPath, { force: true });

  const provider = await resolveProvider(o.provider);
  const result = await provider.run({
    cwd: dir,
    prompt: buildSelectPrompt({ probe, spec, userBrief, hasFrames, chunks, rules: { select: selectRules, edit: editRules }, style, preferences, glossary: glossaryBrief(glossary) }),
    allowedTools: shellEnabled() ? [...ALLOWED_TOOLS, ...SHELL_TOOLS] : ALLOWED_TOOLS,
    deniedTools: shellEnabled() ? DENIED_TOOLS : [...DENIED_TOOLS, "Bash"],
    model: o.model,
    onEvent: o.onEvent,
  });

  await fs.readFile(answerPath, "utf8").catch(() => {
    throw new Error(`agent did not write ${answerName}. Last message: ${result.text.slice(0, 500)}`);
  });

  if (spec.mode === "section") return buildSection({ projectId: o.projectId, videoPath, dir, probe, transcript, spec, signals });
  return buildEdl({ projectId: o.projectId, videoPath, dir, probe, transcript, spec, signals });
}

/**
 * Turn the agent's video.json into a project holding one long video.
 *
 * It arrives as a sequence rather than as clips because that is what it is: one output,
 * many shots, in order. Everything after this point — the template pass, the timeline,
 * the renderer — treats it as an ordinary video, which is the whole reason a long edit
 * did not need a second editor.
 */
export async function buildSection(o: {
  projectId: string;
  videoPath: string;
  dir: string;
  probe: Probe;
  transcript: Transcript;
  spec: SelectionSpec;
  signals?: Signals;
}): Promise<Edl> {
  const { dir, probe, transcript, videoPath, spec } = o;
  const peaks = (o.signals ?? (await readSignals(dir))).peaks.map((p) => p.t);
  const raw = await fs.readFile(path.join(dir, "video.json"), "utf8");
  const { video } = AgentSectionProposals.parse(JSON.parse(raw));

  const mediaId = "original-source";
  const sequenceId = randomUUID().slice(0, 8);
  const { items, beats, keptSec, warnings } = sectionTimeline(video, {
    transcript, probe, output: spec.output, minSegmentSec: spec.minSegmentSec,
    peaks, chapters: spec.chapters, mediaId,
    itemId: (index) => `s${String(index + 1).padStart(2, "0")}_${randomUUID().slice(0, 4)}`,
  });
  // Said, not enforced: a video ten minutes over the template's ceiling is a judgement
  // call for the owner, and silently dropping the end of it would be worse than long.
  if (keptSec > spec.maxSec * 1.15) warnings.push(`the edit runs ${runtime(keptSec)}, past the ${runtime(spec.maxSec)} this template asks for — trim a stretch or raise the ceiling`);
  if (keptSec < spec.minSec * 0.85) warnings.push(`the edit runs ${runtime(keptSec)}, short of the ${runtime(spec.minSec)} this template asks for`);

  const edl = Edl.parse({
    version: 1,
    projectId: o.projectId,
    source: { file: videoPath, width: probe.width, height: probe.height, fps: probe.fps, durationSec: probe.durationSec },
    output: spec.output,
    clips: [],
    media: [{ id: mediaId, name: "Original source", file: videoPath, width: probe.width, height: probe.height, fps: probe.fps, durationSec: probe.durationSec }],
    sequences: [{
      id: sequenceId,
      title: video.title,
      output: spec.output,
      items,
      plan: {
        ...emptySequencePlan(),
        summary: video.summary,
        tags: [...new Set(video.tags.map((t) => t.toLowerCase().trim()).filter(Boolean))],
        score: video.score,
        beats,
        reasons: { ...(video.reason ? { selection: video.reason } : {}), ...(warnings.length ? { warnings: warnings.join("; ") } : {}) },
        generatedAt: Date.now(),
      },
    }],
  });

  await fs.writeFile(ruleMatchesFile(dir), JSON.stringify(video.rules.length ? { [sequenceId]: [...new Set(video.rules)] } : {}, null, 2));
  return edl;
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
  /** What was asked for. The output shape decides the fallback crop, so it is not optional in spirit. */
  spec?: SelectionSpec;
  minSec?: number;
  /** Loudness peaks, so a boundary is never tightened past a reaction. Read from the run when absent. */
  signals?: Signals;
}): Promise<Edl> {
  const { dir, probe, transcript, videoPath } = o;
  const minSec = o.spec?.minSec ?? o.minSec ?? 20;
  const output = o.spec?.output ?? { width: 1080, height: 1920, fps: probe.fps };
  const peaks = (o.signals ?? (await readSignals(dir))).peaks.map((p) => p.t);
  const raw = await fs.readFile(path.join(dir, "clips.json"), "utf8");
  const proposals = AgentClipProposals.parse(JSON.parse(raw));
  const fallbackCrop = centerCrop(probe.width, probe.height, output.width, output.height);

  const matches: Record<string, string[]> = {};
  const clips: Clip[] = proposals.clips
    .map((p) => {
      const [start, end] = tightenBoundaries(transcript.words, p.start, p.end, {
        duration: probe.durationSec, fps: probe.fps, peaks,
      });
      const id = randomUUID().slice(0, 8);
      if (p.rules.length) matches[id] = [...new Set(p.rules)];
      const proposed: Clip = {
        id,
        title: p.title,
        hook: p.hook,
        reason: p.reason,
        score: p.score,
        start: p.start,
        end: p.end,
        crop: p.crop.length ? p.crop : [fallbackCrop],
        layout: p.layout ?? { type: "crop" as const },
        captions: CaptionStyle.parse(p.captions ?? {}),
        words: [],
        // Marked as the selection's own, so a template applied later replaces this
        // first draft — its hook title, its cuts, its push-ins — instead of laying a
        // second set on top of it.
        edits: (p.edits ?? []).map((edit) => ({ ...edit, by: edit.by || SELECTION_AUTHOR })),
        tags: [...new Set(p.tags.map((t) => t.toLowerCase().trim()).filter(Boolean))],
      };
      // The agent wrote its punches, overlays and crop moves against the boundaries it
      // proposed. Settling those boundaries moves the clip under them, so they are
      // rebased through the same trim both interfaces use — an edit that stayed put
      // while the clip moved would point at a different sentence entirely.
      return {
        ...trim(proposed, start, end),
        words: wordsForClip(transcript, start, end),
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
    output,
    clips,
  });

  await resolveImageQueries(edl, o.projectId);
  // Keep only matches for clips that survived filtering, so the host never applies a rule to nothing.
  const kept = new Set(edl.clips.map((c) => c.id));
  await fs.writeFile(ruleMatchesFile(dir), JSON.stringify(Object.fromEntries(Object.entries(matches).filter(([id]) => kept.has(id))), null, 2));
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

/** The run's own signals, for a buildEdl called on its own after the agent finished. */
async function readSignals(dir: string): Promise<Signals> {
  try {
    return JSON.parse(await fs.readFile(path.join(dir, "signals.json"), "utf8")) as Signals;
  } catch {
    return { scenes: [], peaks: [] };
  }
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
