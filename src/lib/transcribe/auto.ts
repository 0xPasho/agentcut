import { randomUUID } from "node:crypto";
import { q, type JobRow } from "../db";
import { readEditor } from "../editor/store";
import { BOOT_ID, claim, ownsJob, reapDeadJobs, release } from "../reaper";
import { markQueued, transcribeProjectMedia } from "./media";
import { resolveTranscribeMode, type TranscribeMode } from "./settings";

/**
 * Newly imported sources recognise themselves, without taking the project away
 * from the person who just imported them.
 *
 * ## The lock question
 *
 * A project runs one job at a time and the `jobs` row with status `running` IS
 * that lock (see EDITOR.md). Automatic transcription must not hold it: the whole
 * point of importing a video is to start editing it, and a recogniser run that
 * locked the project would refuse every edit, every render and every agent turn
 * for minutes — on exactly the footage the person just added. It must not wait
 * for the lock either: an import during a render or an agent run would then sit
 * queued behind work that can itself take minutes, and an agent that imports a
 * source inside its own edit job would wait for a lock it is holding — a deadlock.
 *
 * So this is a **distinct job kind that never claims the lock**. The row is
 * written with status `background`, which `q.activeJob` does not see, so the
 * project stays unlocked; and which `q.unfinishedJobs` does see, so the existing
 * reaper heals it from pid liveness exactly like every other job. Nothing waits
 * on it, and it waits on nothing.
 *
 * Rejected:
 *
 * - *Take the lock like analyze/render/edit.* Locks the person out of the video
 *   they just imported, and deadlocks an agent that imports media mid-run.
 * - *Queue behind the lock and start when it opens.* No deadlock for the human,
 *   but the agent case still deadlocks, and a project with a long render never
 *   gets its words. It also needs a durable queue and a waker, which is a second
 *   scheduler next to the one the app already has.
 * - *No job row at all, just a promise.* Invisible to the other interface and to
 *   the other process, and a crash leaves no trace to reap — the one thing the
 *   reaper exists to prevent.
 *
 * Writes are ordinary revision-checked `project.edit` batches, so the background
 * run and a person editing the same project are exactly the two writers the store
 * already handles: the loser re-reads and retries.
 */
export const TRANSCRIBE_JOB_KIND = "transcribe-media";
/** A job row that is unfinished but does not hold the project. */
export const BACKGROUND_STATUS = "background";

const log = (projectId: string, jobId: string, kind: string, text: string) =>
  q.insertEvent({ project_id: projectId, job_id: jobId, kind, name: "transcribe", text, at: Date.now() });

/** The live background transcription for a project, if one is genuinely running. */
export function backgroundTranscription(projectId: string): JobRow | null {
  const rows = q.backgroundJobs(projectId).filter((j) => j.kind === TRANSCRIBE_JOB_KIND);
  return rows[0] ?? null;
}

declare global {
  /** One recogniser at a time on this machine: it saturates the CPU on its own. */
  var __agentcutTranscribeGate: Promise<unknown> | undefined;
}
function gate<T>(work: () => Promise<T>): Promise<T> {
  const previous = globalThis.__agentcutTranscribeGate ?? Promise.resolve();
  const next = previous.then(work, work);
  globalThis.__agentcutTranscribeGate = next.then(() => {}, () => {});
  return next;
}

export type StartTranscriptionOptions = {
  /** Mark these sources as waiting before draining. Omitted resumes whatever already waits. */
  mediaIds?: string[];
  /** Ignore both the cached transcript and the skip rules. What "transcribe it anyway" means. */
  force?: boolean;
  /** Which skip rules apply. Defaults to the project's setting for an import, `audio` otherwise. */
  gate?: TranscribeMode;
  /** Who asked: "import" for the automatic pass, "" for a person, "agent:<id>" for a turn. */
  by?: string;
  brief?: string;
  provider?: string;
  model?: string;
  /** The recogniser, as `ensureTranscript` takes it. Left alone this is whisper.cpp. */
  recognise?: import("./index").Recogniser;
};

/**
 * Queue sources and make sure something is draining them. Safe to call again while
 * a drain is running: the new sources are marked waiting and the running drain
 * picks them up, so a second import joins the first rather than starting a second
 * recogniser.
 */
export function startMediaTranscription(projectId: string, o: StartTranscriptionOptions = {}) {
  if (!q.getProject(projectId)) throw new Error("Project not found");
  // A drain whose process died still has a row saying `background`; clear it first
  // so a crashed import does not leave the queue with nobody draining it.
  reapDeadJobs(projectId);
  if (o.mediaIds?.length) {
    const known = new Set(readEditor(projectId).edl.media.map((m) => m.id));
    const missing = o.mediaIds.filter((id) => !known.has(id));
    if (missing.length) throw new Error("Media not found");
    markQueued(projectId, o.mediaIds, o.by ?? "");
  }
  const waiting = queued(projectId);
  const existing = backgroundTranscription(projectId);
  if (existing) return { job: existing, queued: waiting, started: false };
  if (!waiting.length) return { job: null, queued: waiting, started: false };

  const now = Date.now();
  const job: JobRow = {
    id: randomUUID().slice(0, 8), project_id: projectId, kind: TRANSCRIBE_JOB_KIND,
    status: BACKGROUND_STATUS, stage: "transcribe", progress: 0, error: null,
    created_at: now, updated_at: now, pid: process.pid, boot_id: BOOT_ID, heartbeat: now,
  };
  q.insertJob(job);
  claim(job.id, projectId);
  // Fire and forget, like every other job: the events feed is the progress channel.
  void drain(projectId, job.id, o)
    .then(() => { if (ownsJob(job.id)) q.setJob(job.id, { status: "done", progress: 1, stage: "done" }); })
    .catch((error: Error) => {
      if (!ownsJob(job.id)) return;
      // A failure here is about the queue, not about one source: a source's own
      // failure is recorded on the source and the drain carries on to the next.
      q.setJob(job.id, { status: "error", error: error.message });
      log(projectId, job.id, "error", error.message);
    })
    .finally(() => release(job.id));
  return { job, queued: waiting, started: true };
}

/** Sources whose words are still owed, oldest first. */
function queued(projectId: string): string[] {
  try { return readEditor(projectId).edl.media.filter((m) => m.transcription?.status === "queued").map((m) => m.id); }
  catch { return []; }
}

async function drain(projectId: string, jobId: string, o: StartTranscriptionOptions) {
  // Everything in this queue is there because somebody put it there — an import that
  // already consulted the setting, a retry, or an agent asking by name. So `off` is
  // not re-applied here; it decides what gets queued, never what a queue does.
  const mode = o.gate ?? (resolveTranscribeMode(projectId).mode === "always" ? "always" : "audio");
  const attempted = new Set<string>();
  let done = 0;
  for (;;) {
    // Cancellation is the same escape hatch every job has: an unlock or a reap takes
    // the job away, `ownsJob` goes false, and this run stops without writing.
    if (!ownsJob(jobId)) return;
    const pending = queued(projectId).filter((id) => !attempted.has(id));
    if (!pending.length) return;
    const mediaId = pending[0];
    attempted.add(mediaId);
    const total = done + pending.length;
    q.setJob(jobId, { stage: `transcribing ${done + 1}/${total}`, progress: done / Math.max(1, total) });
    await gate(() => transcribeProjectMedia(projectId, {
      mediaIds: [mediaId], gate: o.force ? "always" : mode, force: o.force, by: o.by ?? "",
      brief: o.brief, provider: o.provider, model: o.model, recognise: o.recognise,
      keepGoing: () => ownsJob(jobId),
      onLog: (text) => log(projectId, jobId, "log", text),
      onEvent: (e) => { if (e.kind !== "log") log(projectId, jobId, e.kind, e.text.slice(0, 2000)); },
    })).then(({ results }) => {
      for (const r of results) {
        const media = readEditor(projectId).edl.media.find((m) => m.id === r.mediaId);
        const name = media?.name ?? r.mediaId;
        if (r.status === "done") log(projectId, jobId, "stage", `transcribed ${name} — ${r.words} words on ${r.items} shots`);
        else if (r.status === "skipped") log(projectId, jobId, "log", `${name}: not transcribed — ${r.reason}`);
        else log(projectId, jobId, "error", `${name}: ${r.reason}`);
      }
    });
    done += 1;
  }
}

/**
 * Whether an import should hand its new sources to the recogniser at all, and what
 * to record when it should not. `null` means go ahead.
 */
export function importSkipReason(projectId: string, requested?: boolean): string | null {
  if (requested === true) return null;
  const { mode } = resolveTranscribeMode(projectId);
  if (requested === false) return "not requested for this import";
  if (mode === "off") return "automatic transcription is off";
  return null;
}
