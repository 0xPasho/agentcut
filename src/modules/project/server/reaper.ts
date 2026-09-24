import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { q, type JobRow } from "../../../common/server/db";

/**
 * A job row says "running" until the process that owns it writes the ending. Kill
 * that process — Ctrl-C, a crash, a `next dev` restart — and the row stays running
 * forever, so the project's one-job-at-a-time lock never opens again and every later
 * edit is refused with "A job is already running for this project".
 *
 * Every process is local, so liveness is a fact rather than a guess: the row records
 * the owner's pid and a per-run boot id, and `kill(pid, 0)` answers whether that
 * process still exists. The heartbeat is only a backstop for the rare case where the
 * OS handed the pid to something else. A timeout alone would be wrong in both
 * directions: it unlocks too late after a crash, and it would kill a long render that
 * is perfectly healthy but quiet.
 *
 * MCP runs in its own process (lib/mcp.ts) and can start jobs too, so "clear every
 * running row when the web server boots" is not an option — it would cut a live
 * terminal-agent batch out from under itself.
 *
 * A row with status `background` is unfinished work that deliberately does not hold
 * the project — automatic transcription of a newly imported source (see
 * `transcribe/auto.ts`). It is reaped from pid liveness like everything else, but
 * it never hands the project back, because it never took it.
 */

declare global {
  var __agentcutBootId: string | undefined;
  var __agentcutLiveJobs: Map<string, string> | undefined;
  var __agentcutHeartbeat: NodeJS.Timeout | undefined;
  var __agentcutJobAborts: Map<string, AbortController> | undefined;
  var __agentcutJobContext: AsyncLocalStorage<{ jobId: string; abort: AbortController }> | undefined;
}

/** Identifies this run of this process. Survives Next's dev module reloads. */
export const BOOT_ID = (globalThis.__agentcutBootId ??= randomUUID().slice(0, 8));

/** jobId → projectId for the jobs this process is executing right now. */
const live = (globalThis.__agentcutLiveJobs ??= new Map<string, string>());

/**
 * jobId → the switch that stops it. Stopping used to mean abandoning: the row was
 * marked canceled, the project was handed back, and the harness the run had spawned
 * kept going — still burning tokens, still holding the model call, still able to
 * write its answer into a project whose owner had walked away. A job now carries a
 * signal, `spawnStream` kills its child the moment it fires, and the run ends where
 * it was told to end.
 */
const aborts = (globalThis.__agentcutJobAborts ??= new Map<string, AbortController>());

/**
 * Which job the work on this stack belongs to. A signal threaded by hand through
 * conversation, selection, transcription and render would be five signatures deep and
 * would miss the sixth caller; the context travels with the work instead, so anything
 * that spawns a harness under a job can ask whether that job is still wanted.
 */
const context = (globalThis.__agentcutJobContext ??= new AsyncLocalStorage<{ jobId: string; abort: AbortController }>());

/**
 * Run a job's work with the job in context, so everything under it can be stopped.
 * The context carries the controller itself rather than looking it up by id: a
 * stopped run is released from the registry immediately, and the work still on the
 * stack must keep seeing that it was stopped rather than that it was never running.
 */
export function runWithJob<T>(jobId: string, work: () => Promise<T>): Promise<T> {
  const abort = aborts.get(jobId) ?? new AbortController();
  aborts.set(jobId, abort);
  return context.run({ jobId, abort }, work);
}

/** The signal of the job this code is running under, if it is running under one. */
export function currentJobSignal(): AbortSignal | undefined {
  return context.getStore()?.abort.signal;
}

/** True when the work on this stack has been stopped by its owner. */
export const jobStopped = () => currentJobSignal()?.aborted ?? false;

/** Stop a job's work where it stands. The row and the lock are the caller's to settle. */
export function cancelJob(jobId: string, reason: string) {
  const controller = aborts.get(jobId);
  if (!controller || controller.signal.aborted) return false;
  controller.abort(new Error(reason));
  return true;
}

const HEARTBEAT_MS = 15_000;
/** A live pid whose heartbeat stopped this long ago was recycled by the OS. */
const STALE_MS = 5 * 60_000;

/** Same machine, so existence is a fact. EPERM means it exists and is somebody else's. */
export function processAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM"; // only ESRCH means gone
  }
}

export function isAlive(job: JobRow) {
  if (job.boot_id === BOOT_ID) return live.has(job.id); // ours: the registry is the truth
  if (!job.pid || !job.boot_id) return false; // written before this existed, unverifiable
  if (!processAlive(job.pid)) return false;
  return Date.now() - (job.heartbeat ?? job.updated_at) < STALE_MS;
}

function beat() {
  if (live.size) q.beat([...live.keys()], Date.now());
}

function startHeartbeat() {
  if (globalThis.__agentcutHeartbeat) return;
  const timer = setInterval(beat, HEARTBEAT_MS);
  timer.unref?.(); // never hold the process open for a heartbeat
  globalThis.__agentcutHeartbeat = timer;
}

/** This process takes ownership of a job it is about to execute. */
export function claim(jobId: string, projectId: string) {
  live.set(jobId, projectId);
  aborts.set(jobId, new AbortController());
  q.beat([jobId], Date.now());
  startHeartbeat();
}

export function release(jobId: string) {
  live.delete(jobId);
  aborts.delete(jobId);
  if (!live.size && globalThis.__agentcutHeartbeat) {
    clearInterval(globalThis.__agentcutHeartbeat);
    globalThis.__agentcutHeartbeat = undefined;
  }
}

/** Is this job still ours to finish, or did a reap or an unlock take it away? */
export function ownsJob(jobId: string) {
  return live.has(jobId);
}

/**
 * Close out every unfinished job whose owner is gone. Returns the rows it closed.
 * Cheap enough to call on the project read path, which is what makes a stuck project
 * heal itself as soon as anybody looks at it.
 */
export function reapDeadJobs(projectId?: string) {
  const dead: JobRow[] = [];
  for (const job of q.unfinishedJobs(projectId)) {
    if (isAlive(job)) continue;
    const reason = `interrupted — the app closed during ${job.stage ?? job.kind}`;
    q.setJob(job.id, { status: "error", error: reason });
    // Background work never held the project, so handing the project back is not
    // this row's to do: doing it would clear the status of a render or an agent
    // run that is alive and holding the lock right now. The sources it had not
    // reached are still marked waiting in the EDL, which is exactly true — they
    // resume on the next import, retry or `media.transcribe`.
    if (job.status === "background") q.insertEvent({ project_id: job.project_id, job_id: job.id, kind: "error", name: "job", text: reason, at: Date.now() });
    else releaseProject(job.project_id, job.id, reason);
    dead.push(job);
  }
  return dead;
}

/**
 * Hand the project back to the user. A half-finished run leaves the project's status
 * at a working value like "agent"; leaving `error` set would paint the UI red over a
 * job nobody is waiting for any more, so the status returns to whatever the project
 * was before the job started.
 */
function releaseProject(projectId: string, jobId: string, reason: string) {
  const project = q.getProject(projectId);
  if (!project) return;
  q.setProject(projectId, { status: project.edl ? "ready" : "new", error: null });
  q.insertEvent({ project_id: projectId, job_id: jobId, kind: "error", name: "job", text: reason, at: Date.now() });
}

/**
 * Stop a run and give the project back — the button behind "Stop", and the escape
 * hatch for a run that is genuinely stuck.
 *
 * The job's signal fires, which kills the harness it spawned and ends the work where
 * it stands; `ownsJob` still makes a late result a no-op, for the parts of a run that
 * only notice the signal at their next step (a render mid-frame, an ffmpeg pass).
 */
export function unlockProject(projectId: string) {
  // "Give me my project back" also means "stop recognising my footage". Background
  // transcription holds no lock, but it is work the owner did not ask to continue,
  // and its drain loop stops as soon as `ownsJob` goes false.
  const background = q.backgroundJobs(projectId);
  for (const job of background) {
    q.setJob(job.id, { status: "canceled", error: `stopped by the owner during ${job.stage ?? job.kind}` });
    cancelJob(job.id, "stopped by the owner");
    release(job.id);
    q.insertEvent({ project_id: projectId, job_id: job.id, kind: "error", name: "job", text: `transcription stopped by the owner`, at: Date.now() });
  }
  const job = q.activeJob(projectId);
  if (!job) return background[0] ?? null;
  const reason = `stopped by the owner during ${job.stage ?? job.kind}`;
  q.setJob(job.id, { status: "canceled", error: reason });
  cancelJob(job.id, reason);
  release(job.id);
  releaseProject(projectId, job.id, reason);
  return job;
}
