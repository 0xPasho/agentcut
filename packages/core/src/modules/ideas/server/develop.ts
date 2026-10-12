import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { WORKSPACE } from "../../../common/server/config";
import { extractJson, getProvider } from "../../agent/server/providers";
import { AGENT_SANDBOX_TOOLS } from "../../agent/data";
import { cancelJob, release, runWithJob } from "../../project/server/reaper";
import { DEVELOP_IDLE_MS, DEVELOP_MAX_MS, REF_TEXT_LIMIT } from "../data";
import { developPrompt, saveForPrompt } from "../lib";
import { Brief, type DevelopRequest, type Idea, type IdeaRun, type Save } from "../types";
import { saveDir } from "./saves";
import { framesFor, transcriptFor } from "./study";
import { finishRun, getIdea, ideaDir, runActivity, startRun } from "./store";

const jobKey = (runId: string) => `idea-run:${runId}`;

/**
 * Develop an idea with every harness asked for, side by side. Each gets its own folder
 * holding the same material, so two harnesses never read each other's half-written
 * files, and each answer lands as its own run the board can compare. Returns as soon
 * as the runs are started; the board polls for their ends.
 */
export async function developIdea(ideaId: string, request: DevelopRequest): Promise<IdeaRun[]> {
  const idea = getIdea(ideaId);
  if (!idea) throw new Error(`No idea ${ideaId}`);
  const harnesses = [...new Set(request.harnesses)];
  for (const id of harnesses) {
    const provider = getProvider(id);
    if (!(await provider.available())) throw new Error(`${provider.label} is not installed on this computer.`);
  }
  const instruction = request.instruction?.trim() ?? "";
  const runs = harnesses.map((harness) => startRun(ideaId, harness, request.models?.[harness] || null, instruction));
  // Watching the videos happens once for every harness, after the runs show as started.
  void (async () => {
    const material = await studySaves(idea.saves, (line) => runs.forEach((r) => runActivity(r.id, line)));
    for (const run of runs) {
      // Stopped while the videos were being studied: nothing to start.
      if (getIdea(ideaId)?.runs.find((r) => r.id === run.id)?.status !== "running") continue;
      try {
        void execute(run, await prepareFolder(idea, run, material));
      } catch (error) {
        finishRun(run.id, { status: "error", error: (error as Error).message });
      }
    }
  })();
  return runs;
}

export function stopRuns(idea: Idea): number {
  let stopped = 0;
  for (const run of idea.runs.filter((r) => r.status === "running")) {
    if (cancelJob(jobKey(run.id), "Stopped from the board")) stopped++;
    else finishRun(run.id, { status: "stopped", error: "Stopped from the board" });
  }
  return stopped;
}

type Material = Map<string, { frames: string[]; transcript?: string }>;

/** Frames and transcripts for every saved video, best effort: a save without them is still a save. */
async function studySaves(saves: Save[], say: (line: string) => void): Promise<Material> {
  const material: Material = new Map();
  for (const save of saves) {
    if (save.mediaStatus !== "done" || !save.mediaFile) continue;
    const who = save.author || save.site || "a saved video";
    say(`Looking at ${who}…`);
    const frames = await framesFor(save).catch(() => []);
    say(`Listening to ${who}…`);
    const transcript = await transcriptFor(save).catch(() => "");
    material.set(save.id, { frames, transcript: transcript || undefined });
  }
  return material;
}

async function prepareFolder(idea: Idea, run: IdeaRun, material: Material): Promise<string> {
  const dir = path.join(ideaDir(idea.id), "runs", run.id);
  await fs.mkdir(path.join(dir, "media"), { recursive: true });
  await fs.writeFile(path.join(dir, "idea.json"), JSON.stringify({
    title: idea.title, note: idea.note, tags: idea.tags, instruction: run.instruction || undefined,
  }, null, 2));
  const references = [];
  for (const save of idea.saves) {
    const files: { screenshot?: string; frames?: string[]; transcript?: string } = {};
    const copy = async (name: string) => {
      const to = `media/${save.id}-${name}`;
      await fs.copyFile(path.join(saveDir(save.id), name), path.join(dir, to));
      return to;
    };
    if (save.screenshot) files.screenshot = await copy(save.screenshot).catch(() => undefined);
    const studied = material.get(save.id);
    if (studied?.frames.length) files.frames = (await Promise.all(studied.frames.map((f) => copy(f).catch(() => "")))).filter(Boolean);
    if (studied?.transcript) files.transcript = studied.transcript.slice(0, REF_TEXT_LIMIT);
    references.push(saveForPrompt(save, REF_TEXT_LIMIT, files));
  }
  await fs.writeFile(path.join(dir, "references.json"), JSON.stringify(references, null, 2));
  const preferences = path.join(WORKSPACE, "preferences.md");
  if (existsSync(preferences)) await fs.copyFile(preferences, path.join(dir, "preferences.md"));
  return dir;
}

async function execute(run: IdeaRun, cwd: string) {
  const key = jobKey(run.id);
  try {
    const provider = getProvider(run.harness);
    const result = await runWithJob(key, () => provider.run({
      prompt: developPrompt(existsSync(path.join(cwd, "preferences.md"))),
      cwd,
      // Reading is all a brief needs. Page text is written by strangers, so nothing else is open.
      allowedTools: ["Read", "Glob", "Grep"],
      deniedTools: [...AGENT_SANDBOX_TOOLS, "Write", "Edit", "MultiEdit"],
      model: run.model ?? undefined,
      idleMs: DEVELOP_IDLE_MS,
      timeoutMs: DEVELOP_MAX_MS,
      onEvent: (event) => {
        if (event.kind === "tool") runActivity(run.id, `${event.name ?? "Tool"}: ${event.text}`);
        else if (event.kind === "text") runActivity(run.id, event.text.split("\n")[0]);
      },
    }));
    let brief: Brief | null = null;
    try {
      const parsed = Brief.safeParse(extractJson(result.text));
      if (parsed.success) brief = parsed.data;
    } catch {
      // No JSON: the text is still kept and shown, it just is not a brief.
    }
    finishRun(run.id, {
      status: brief ? "done" : "error",
      text: result.text,
      brief,
      costUsd: result.costUsd ?? null,
      error: brief ? null : "The harness answered without a brief. Its reply is kept below.",
    });
  } catch (error) {
    const message = (error as Error).message;
    finishRun(run.id, { status: /was stopped/.test(message) ? "stopped" : "error", error: message.slice(0, 2000) });
  } finally {
    release(key);
  }
}
