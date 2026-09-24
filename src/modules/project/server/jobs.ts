import { randomUUID } from "node:crypto";
import { projectDir } from "../../../common/server/config";
import { db, q, type JobRow } from "../../../common/server/db";
import { probe as probeFile } from "../../media/server/ffmpeg";
import { ensureTranscript } from "../../transcription/server/transcribe";
import { computeSignals } from "../../clipping/server/signals";
import { selectClips, readRuleMatches } from "../../clipping/server/select";
import { readEditor, publishClips, RevisionConflict } from "../../editor/server/store";
import { downloadUrl, isUrl } from "./ingest";
import { BOOT_ID, claim, ownsJob, reapDeadJobs, release, runWithJob } from "./reaper";
import { effectiveSelection, taskForJobKind } from "../../agent/server/selection";

export type JobKind = "analyze" | "render" | "edit" | "transcribe" | "batch";

function log(projectId: string, jobId: string, kind: string, text: string, name?: string) {
  q.insertEvent({ project_id: projectId, job_id: jobId, kind, name: name ?? null, text, at: Date.now() });
}

export type AnalyzeOptions = {
  targetClipCount?: number;
  minSec?: number;
  maxSec?: number;
  userBrief?: string;
  provider?: string;
  model?: string;
  instruction?: string;
  expectedRevision?: number;
  /** For an edit: which video is open and what is selected. */
  sequenceId?: string;
  context?: import("../../agent/server/editor-agent").MessageContext;
  /** Which interface sent the instruction. */
  source?: "web" | "cli" | "mcp";
  /** Batch: redo videos that already have a plan. */
  force?: boolean;
  concurrency?: number;
};

export function startJob(projectId: string, kind: JobKind, options: AnalyzeOptions & { only?: string[] } = {}) {
  if (!q.getProject(projectId)) throw new Error("Project not found");
  // Every agent run in this app is a job, so this is the one place the owner's
  // harness choice has to be applied. The runners below stay storage-free and
  // take the answer as an argument; an explicit provider/model still wins,
  // because that is a caller's instruction rather than a standing preference.
  options = { ...options, ...effectiveSelection(projectId, { provider: options.provider, model: options.model }, taskForJobKind(kind)) };
  if (options.expectedRevision !== undefined) {
    const current = readEditor(projectId);
    if (current.revision !== options.expectedRevision) throw new RevisionConflict(current);
  }
  // A row left behind by a process that died still holds the lock; clear those first
  // so the only thing that can refuse this job is a run that is genuinely alive.
  reapDeadJobs(projectId);
  const existing = q.activeJob(projectId);
  if (existing) throw new Error(`A ${existing.kind} job is already running for this project`);

  const now = Date.now();
  const job: JobRow = {
    id: randomUUID().slice(0, 8),
    project_id: projectId,
    kind,
    status: "running",
    stage: kind === "analyze" ? "probe" : kind === "transcribe" ? "transcribe" : kind === "batch" ? "batch" : kind === "edit" ? "agent" : "bundling",
    progress: 0,
    error: null,
    created_at: now,
    updated_at: now,
    pid: process.pid,
    boot_id: BOOT_ID,
    heartbeat: now,
  };
  q.insertJob(job);
  claim(job.id, projectId);

  // Fire and forget: the SSE stream and the jobs table are the progress channel. The
  // work runs with the job in context, so Stop reaches whatever it spawned.
  void runWithJob(job.id, () => execute(job, options))
    .then(() => {
      // An unlock or a reap already gave the project back; this run's ending is stale.
      if (ownsJob(job.id)) q.setJob(job.id, { status: "done", progress: 1, stage: "done" });
    })
    .catch((err: Error) => {
      if (!ownsJob(job.id)) return;
      q.setJob(job.id, { status: "error", error: err.message });
      q.setProject(projectId, { status: "error", error: err.message });
      log(projectId, job.id, "error", err.message);
    })
    .finally(() => release(job.id));

  return job;
}

async function execute(job: JobRow, options: AnalyzeOptions & { only?: string[] }) {
  const project = q.getProject(job.project_id);
  if (!project) throw new Error("project not found");
  const dir = projectDir(project.id);

  if (job.kind === "edit") {
    const { sendMessage } = await import("../../agent/server/conversation");
    q.setProject(project.id, { status: "agent", error: null });
    await sendMessage(project.id, options.instruction ?? "", {
      provider: options.provider, model: options.model, jobId: job.id,
      source: options.source ?? "web", sequenceId: options.sequenceId, context: options.context,
      onEvent: e => log(project.id, job.id, e.kind, e.text, e.name),
    });
    q.setProject(project.id, { status: "ready", error: null });
    return;
  }
  if (job.kind === "batch") {
    const { runBatch } = await import("./batch");
    q.setProject(project.id, { status: "agent", error: null });
    const result = await runBatch(project.id, {
      brief: options.userBrief, provider: options.provider, model: options.model, force: options.force, concurrency: options.concurrency, jobId: job.id,
      onStage: (stage, progress) => { q.setJob(job.id, { stage, progress }); log(project.id, job.id, "stage", stage); },
      onLog: (kind, text) => log(project.id, job.id, kind, text, "batch"),
      onEvent: (e) => { if (e.kind !== "log") log(project.id, job.id, e.kind, e.text.slice(0, 2000), e.name); },
    });
    q.setProject(project.id, { status: "ready", error: null });
    const failed = result.videos.filter((v) => !v.ok);
    log(project.id, job.id, "stage", `batch done — ${result.videos.length - failed.length} of ${result.videos.length} videos edited${failed.length ? `; still pending: ${failed.map((v) => v.title).join(", ")}` : ""}`);
    return;
  }
  if (job.kind === "transcribe") {
    q.setProject(project.id, { status: "transcribe", error: null });
    const { resyncTranscript } = await import("../../transcription/server/resync");
    const result = await resyncTranscript(project.id, {
      brief: options.userBrief,
      provider: options.provider,
      model: options.model,
      expectedRevision: options.expectedRevision,
      onLog: (text) => log(project.id, job.id, "log", text),
      onEvent: (e) => {
        if (e.kind !== "log") log(project.id, job.id, e.kind, e.text.slice(0, 2000), e.name);
      },
    });
    q.setProject(project.id, { status: "ready", error: null });
    log(project.id, job.id, "stage", `captions re-synced from ${result.transcript.words.length} words`);
    return;
  }
  if (job.kind === "analyze") {
    let source = project.source_path;
    if (isUrl(source)) {
      q.setJob(job.id, { stage: "download", progress: 0.01 });
      q.setProject(project.id, { status: "download" });
      source = await downloadUrl(source, dir, (t) => log(project.id, job.id, "log", t));
      db.prepare("UPDATE projects SET source_path = ? WHERE id = ?").run(source, project.id);
    }
    return analyze(job, source, dir, options);
  }
  return render(job, dir, options.only, options.expectedRevision);
}

async function analyze(job: JobRow, sourcePath: string, dir: string, options: AnalyzeOptions) {
  const pid = job.project_id;
  const stage = (name: string, progress: number) => {
    q.setJob(job.id, { stage: name, progress });
    q.setProject(pid, { status: name });
    log(pid, job.id, "stage", name);
  };

  // The brief is the first turn of the project's conversation, and the plan's goal.
  if (options.userBrief?.trim()) {
    const { recordMessage } = await import("../../agent/server/conversation");
    recordMessage(pid, { role: "user", source: "brief", text: options.userBrief.trim(), jobId: job.id });
  }

  stage("probe", 0.02);
  const meta = await probeFile(sourcePath);
  q.setProject(pid, { probe: JSON.stringify(meta) });
  log(pid, job.id, "log", `${meta.width}x${meta.height} ${meta.fps.toFixed(0)}fps ${Math.round(meta.durationSec)}s`);

  stage("transcribe", 0.1);
  const { transcript } = await ensureTranscript({
    dir,
    sourcePath,
    projectId: pid,
    brief: options.userBrief,
    provider: options.provider,
    model: options.model,
    onLog: (text) => log(pid, job.id, "log", text),
    onEvent: (e) => {
      if (e.kind !== "log") log(pid, job.id, e.kind, e.text.slice(0, 2000), e.name);
    },
  });

  stage("signals", 0.45);
  const signals = await computeSignals(sourcePath, meta, (text) => log(pid, job.id, "log", text));
  log(pid, job.id, "log", `${signals.scenes.length} scene cuts, ${signals.peaks.length} loudness peaks`);

  stage("agent", 0.55);
  const edl = await selectClips({
    projectId: pid,
    videoPath: sourcePath,
    dir,
    probe: meta,
    transcript,
    signals,
    targetClipCount: options.targetClipCount ?? 6,
    minSec: options.minSec ?? 20,
    maxSec: options.maxSec ?? 75,
    userBrief: options.userBrief ?? "",
    provider: options.provider,
    model: options.model,
    onEvent: (e) => {
      if (e.kind === "log") return;
      log(pid, job.id, e.kind, e.text.slice(0, 2000), e.name);
    },
  });

  publishClips(pid, edl);
  if (options.userBrief?.trim()) {
    const current = readEditor(pid);
    if (!current.edl.plan.brief.goal) {
      const { editProject } = await import("../../editor/server/store");
      editProject(pid, { expectedRevision: current.revision, operations: [{ type: "plan.patch", patch: { brief: { ...current.edl.plan.brief, goal: options.userBrief.trim() } } }] });
    }
  }
  await applyMatchedRules(pid, dir, (kind, text) => log(pid, job.id, kind, text, "rules"));
  q.setProject(pid, { status: "ready", error: null });
  log(pid, job.id, "stage", `ready — ${edl.clips.length} clips`);
}

/**
 * Execute the editing rules the selection agent judged to hold, clip by clip. Each
 * is an ordinary template application through the shared operations; a failure
 * is logged and the clip is left as generated rather than failing the whole job.
 */
export async function applyMatchedRules(projectId: string, dir: string, report: (kind: string, text: string) => void) {
  const matches = await readRuleMatches(dir);
  const entries = Object.entries(matches).filter(([, ids]) => ids.length);
  if (!entries.length) return;
  const { applyRules } = await import("../../rules/server/apply");
  for (const [clipId, ruleIds] of entries) {
    try {
      const { revision } = readEditor(projectId);
      const result = await applyRules(projectId, { clipId, ruleIds }, revision);
      report("tool", `clip ${clipId}: rules ${ruleIds.join(", ")} → template ${result.templateId} (${result.templateFrom})${result.applied ? `, ${result.applied.images} pictures` : ", no timeline change"}${result.ignored.length ? `; ignored ${result.ignored.join(", ")}` : ""}`);
    } catch (error) {
      report("error", `clip ${clipId}: rules ${ruleIds.join(", ")} failed — ${(error as Error).message}`);
    }
  }
}

async function render(job: JobRow, dir: string, only?: string[], expectedRevision?: number) {
  const pid = job.project_id;
  const project = q.getProject(pid);
  if (!project?.edl) throw new Error("no EDL yet — run analyze first");

  q.setProject(pid, { status: "rendering" });
  const { renderProject } = await import("../../render/server/render-project");
  const { renderTargets, markRendered } = await import("./batch");
  const targets = renderTargets(readEditor(pid).edl, only);
  const rendered = await renderProject(pid, {
    only: targets, expectedRevision,
    onProgress: (p) => {
      if (p.stage === "preparing") {
        q.setJob(job.id, { stage: p.total ? `preparing footage ${p.index}/${p.total}` : "preparing footage", progress: p.progress });
        return;
      }
      if (p.stage === "bundling") {
        q.setJob(job.id, { stage: "bundling", progress: 0 });
        return log(pid, job.id, "stage", "bundling composition");
      }
      const overall = (p.index + p.progress) / Math.max(1, p.total);
      q.setJob(job.id, { stage: `rendering ${p.index + 1}/${p.total}`, progress: overall });
      if (p.stage === "done") log(pid, job.id, "stage", `rendered ${p.title}`);
    },
  });

  markRendered(pid, rendered.outputs.map((o) => o.clip.id));
  q.setProject(pid, { status: "ready" });
  log(pid, job.id, "stage", "render complete");
}

export { db };
