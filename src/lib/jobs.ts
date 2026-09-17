import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { projectDir } from "./config";
import { db, q, type JobRow } from "./db";
import { probe as probeFile, extractAudio } from "./media";
import { transcribe, available as whisperAvailable } from "./transcribe/whispercpp";
import { Transcript } from "./transcript";
import { computeSignals } from "./pipeline/signals";
import { selectClips } from "./pipeline/select";
import { readEditor, publishClips, RevisionConflict } from "./editor/store";
import { downloadUrl, isUrl } from "./ingest";

declare global {
  var __agentcutRunning: Set<string> | undefined;
}
const running = (globalThis.__agentcutRunning ??= new Set<string>());

export type JobKind = "analyze" | "render" | "edit";

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
};

export function startJob(projectId: string, kind: JobKind, options: AnalyzeOptions & { only?: string[] } = {}) {
  if (!q.getProject(projectId)) throw new Error("Project not found");
  if (options.expectedRevision !== undefined) {
    const current = readEditor(projectId);
    if (current.revision !== options.expectedRevision) throw new RevisionConflict(current);
  }
  const existing = q.activeJob(projectId);
  if (existing) throw new Error("A job is already running for this project");
  if (running.has(projectId)) throw new Error("a job is already running for this project");

  const now = Date.now();
  const job: JobRow = {
    id: randomUUID().slice(0, 8),
    project_id: projectId,
    kind,
    status: "running",
    stage: kind === "analyze" ? "probe" : "bundling",
    progress: 0,
    error: null,
    created_at: now,
    updated_at: now,
  };
  q.insertJob(job);
  running.add(projectId);

  // Fire and forget: the SSE stream and the jobs table are the progress channel.
  void execute(job, options)
    .then(() => q.setJob(job.id, { status: "done", progress: 1, stage: "done" }))
    .catch((err: Error) => {
      q.setJob(job.id, { status: "error", error: err.message });
      q.setProject(projectId, { status: "error", error: err.message });
      log(projectId, job.id, "error", err.message);
    })
    .finally(() => running.delete(projectId));

  return job;
}

async function execute(job: JobRow, options: AnalyzeOptions & { only?: string[] }) {
  const project = q.getProject(job.project_id);
  if (!project) throw new Error("project not found");
  const dir = projectDir(project.id);

  if (job.kind === "edit") {
    const { runEditorAgent } = await import("./editor/agent");
    q.setProject(project.id, { status: "agent", error: null });
    await runEditorAgent(project.id, options.instruction ?? "", {
      provider: options.provider, model: options.model,
      onEvent: e => log(project.id, job.id, e.kind, e.text, e.name),
    });
    q.setProject(project.id, { status: "ready", error: null });
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

  stage("probe", 0.02);
  const meta = await probeFile(sourcePath);
  q.setProject(pid, { probe: JSON.stringify(meta) });
  log(pid, job.id, "log", `${meta.width}x${meta.height} ${meta.fps.toFixed(0)}fps ${Math.round(meta.durationSec)}s`);

  stage("transcribe", 0.1);
  const transcriptPath = path.join(dir, "transcript.json");
  const cached = await fs.readFile(transcriptPath, "utf8").catch(() => null);
  let transcript: Transcript;
  if (cached) {
    transcript = Transcript.parse(JSON.parse(cached));
    log(pid, job.id, "log", `reusing transcript (${transcript.words.length} words)`);
  } else {
    if (!(await whisperAvailable())) throw new Error("whisper-cli not found — run: brew install whisper-cpp");
    const wav = await extractAudio(sourcePath, path.join(dir, "audio.wav"));
    transcript = await transcribe(wav, { outDir: dir });
    log(pid, job.id, "log", `${transcript.segments.length} segments, ${transcript.words.length} words`);
  }

  stage("signals", 0.45);
  const signals = await computeSignals(sourcePath, meta);
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
  q.setProject(pid, { status: "ready", error: null });
  log(pid, job.id, "stage", `ready — ${edl.clips.length} clips`);
}

async function render(job: JobRow, dir: string, only?: string[], expectedRevision?: number) {
  const pid = job.project_id;
  const project = q.getProject(pid);
  if (!project?.edl) throw new Error("no EDL yet — run analyze first");

  q.setProject(pid, { status: "rendering" });
  const { renderProject } = await import("./editor/render");
  await renderProject(pid, {
    only, expectedRevision,
    onProgress: (p) => {
      if (p.stage === "bundling") {
        q.setJob(job.id, { stage: "bundling", progress: 0 });
        return log(pid, job.id, "stage", "bundling composition");
      }
      const overall = (p.index + p.progress) / Math.max(1, p.total);
      q.setJob(job.id, { stage: `rendering ${p.index + 1}/${p.total}`, progress: overall });
      if (p.stage === "done") log(pid, job.id, "stage", `rendered ${p.title}`);
    },
  });

  q.setProject(pid, { status: "ready" });
  log(pid, job.id, "stage", "render complete");
}

export { db };
