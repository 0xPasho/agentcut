import { q } from "../../../common/server/db";
import { editProject, readEditor, RevisionConflict } from "../../editor/server/store";
import type { AgentEvent, AgentProvider } from "../../agent/server/providers";
import { recordMessage } from "../../agent/server/conversation";

/**
 * N raw videos in, N edited videos out, looking like one set. One project, one
 * sequence per video, one conversation. The shared plan is written first from
 * titles and the brief; each video is then transcribed, planned and edited on its
 * own with the shared plan as context; the shared plan is written once more at the
 * end so the series knows what every video covers. A failed video is reported and
 * left pending; the rest continue. Re-running only touches videos still pending.
 */
export type BatchOptions = {
  brief?: string;
  provider?: string;
  model?: string;
  /** Parallel plan-and-edit runs. Transcription is sequential: the recogniser saturates the machine on its own. */
  concurrency?: number;
  /** Redo videos that already have a plan. */
  force?: boolean;
  /** Skip transcription (tests, or media already transcribed). */
  transcribe?: boolean;
  runner?: AgentProvider;
  jobId?: string;
  onStage?: (stage: string, progress: number) => void;
  onLog?: (kind: string, text: string) => void;
  onEvent?: (e: AgentEvent) => void;
};

export type BatchResult = { revision: number; videos: Array<{ sequenceId: string; title: string; ok: boolean; status: string; error?: string }> };

export async function runBatch(projectId: string, o: BatchOptions = {}): Promise<BatchResult> {
  if (!q.getProject(projectId)) throw new Error("Project not found");
  const log = o.onLog ?? (() => {});
  const stage = o.onStage ?? (() => {});
  const agentOptions = { provider: o.provider, model: o.model, runner: o.runner, onEvent: o.onEvent };

  if (o.brief?.trim()) {
    recordMessage(projectId, { role: "user", source: "brief", text: o.brief.trim(), jobId: o.jobId });
    const current = readEditor(projectId);
    if (!current.edl.plan.brief.goal) editProject(projectId, { expectedRevision: current.revision, operations: [{ type: "plan.patch", patch: { brief: { ...current.edl.plan.brief, goal: o.brief.trim() } } }] });
  }

  const start = readEditor(projectId);
  const pending = start.edl.sequences.filter((s) => o.force || (s.plan.status === "pending" && !s.plan.generatedAt));
  if (!pending.length) { log("stage", "nothing pending — every video already has a plan"); return { revision: start.revision, videos: [] }; }

  if (o.transcribe !== false) {
    stage("transcribing", 0.02);
    const { transcribeProjectMedia } = await import("../../transcription/server/media");
    const mediaIds = [...new Set(pending.flatMap((s) => s.items.map((i) => i.mediaId)).filter((id): id is string => !!id))];
    // The same skip rules an import uses: a set of forty raw videos should not pay
    // for a recogniser run on the ones with nothing on their audio track. A source
    // already transcribed on import reuses its cached transcript here, so this pass
    // costs nothing twice, and a run already in flight is joined rather than raced.
    const { results } = await transcribeProjectMedia(projectId, { mediaIds, brief: o.brief, provider: o.provider, model: o.model, gate: "audio", by: "batch", onLog: (t) => log("log", t), onEvent: o.onEvent });
    for (const r of results) {
      if (r.error) log("error", `transcribe ${r.mediaId}: ${r.error}`);
      else if (r.status === "skipped") log("log", `${r.mediaId}: not transcribed — ${r.reason}`);
      else log("log", `transcribed ${r.mediaId}: ${r.words} words on ${r.items} shots`);
    }
  }

  const { generateProjectPlan, generateSequencePlan } = await import("../../plan/server/generate");
  const { applyPlan } = await import("../../plan/server/apply");
  stage("planning the set", 0.15);
  try { await generateProjectPlan(projectId, agentOptions); log("stage", "shared plan written"); }
  catch (error) { log("error", `shared plan: ${(error as Error).message}`); }

  const videos: BatchResult["videos"] = [];
  let done = 0;
  // Two workers write to one project: a plan lands while another video is being applied.
  // Each write is revision-checked, so the loser simply reads again and retries.
  const applyWithRetry = async (sequenceId: string) => {
    for (let attempt = 0; ; attempt++) {
      try { return await applyPlan(projectId, { sequenceId }, readEditor(projectId).revision); }
      catch (error) { if (!(error instanceof RevisionConflict) || attempt >= 5) throw error; }
    }
  };
  const work = async (sequenceId: string, title: string) => {
    try {
      await generateSequencePlan(projectId, { sequenceId }, agentOptions);
      const result = await applyWithRetry(sequenceId);
      videos.push({ sequenceId, title, ok: true, status: "edited" });
      log("tool", `${title}: planned and edited with ${result.templateId}${result.applied ? `, ${result.applied.images} pictures` : ""}`);
    } catch (error) {
      const message = (error as Error).message;
      videos.push({ sequenceId, title, ok: false, status: "pending", error: message });
      log("error", `${title}: ${message}`);
      // Leave the reason on the plan so the panel can show why this one is still pending.
      try {
        const current = readEditor(projectId);
        const plan = current.edl.sequences.find((s) => s.id === sequenceId)?.plan;
        if (plan) editProject(projectId, { expectedRevision: current.revision, operations: [{ type: "sequence.plan.patch", sequenceId, patch: { reasons: { ...plan.reasons, error: message } } }] });
      } catch { /* the error is already in the log */ }
    } finally {
      done += 1;
      stage(`editing ${done}/${pending.length}`, 0.2 + 0.7 * (done / pending.length));
    }
  };
  const queue = pending.map((s) => ({ id: s.id, title: s.title }));
  const workers = Array.from({ length: Math.max(1, Math.min(o.concurrency ?? 2, queue.length)) }, async () => {
    for (let next = queue.shift(); next; next = queue.shift()) await work(next.id, next.title);
  });
  await Promise.all(workers);

  if (videos.some((v) => v.ok)) {
    stage("closing the set", 0.95);
    try { await generateProjectPlan(projectId, agentOptions); } catch (error) { log("error", `shared plan: ${(error as Error).message}`); }
  }
  videos.sort((a, b) => pending.findIndex((s) => s.id === a.sequenceId) - pending.findIndex((s) => s.id === b.sequenceId));
  return { revision: readEditor(projectId).revision, videos };
}

/**
 * What a render with no explicit list covers: every generated clip, and the videos that
 * were approved (or already rendered). A project where nothing has been approved yet
 * renders every video, because there is nothing to gate.
 */
export function renderTargets(edl: ReturnType<typeof readEditor>["edl"], only?: string[]): string[] | undefined {
  if (only) return only;
  const approved = edl.sequences.filter((s) => s.plan.status === "approved" || s.plan.status === "rendered").map((s) => s.id);
  if (!approved.length) return undefined;
  return [...edl.clips.map((c) => c.id), ...approved];
}

/** After a render: the videos that were rendered are now `rendered`. */
export function markRendered(projectId: string, sequenceIds: string[]) {
  const current = readEditor(projectId);
  const operations = current.edl.sequences
    .filter((s) => sequenceIds.includes(s.id) && s.plan.status !== "rendered")
    .map((s) => ({ type: "sequence.plan.patch" as const, sequenceId: s.id, patch: { status: "rendered" as const } }));
  if (operations.length) editProject(projectId, { expectedRevision: current.revision, operations });
}
