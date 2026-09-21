import { randomUUID } from "node:crypto";
import { q, type JobRow } from "./db";

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
 */

declare global {
  var __agentcutBootId: string | undefined;
  var __agentcutLiveJobs: Map<string, string> | undefined;
  var __agentcutHeartbeat: NodeJS.Timeout | undefined;
}

/** Identifies this run of this process. Survives Next's dev module reloads. */
export const BOOT_ID = (globalThis.__agentcutBootId ??= randomUUID().slice(0, 8));

/** jobId → projectId for the jobs this process is executing right now. */
const live = (globalThis.__agentcutLiveJobs ??= new Map<string, string>());

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
  q.beat([jobId], Date.now());
  startHeartbeat();
}

export function release(jobId: string) {
  live.delete(jobId);
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
    releaseProject(job.project_id, job.id, reason);
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
 * Force the lock open on a job this process cannot prove is dead — the escape hatch
 * for a run that is genuinely stuck, e.g. a model call that never returns. The work
 * is abandoned, not cancelled: nothing interrupts it, and `ownsJob` makes its result
 * a no-op if it ever does come back. Real cooperative cancellation needs an
 * AbortSignal threaded through conversation, render and transcribe; it is not here yet.
 */
export function unlockProject(projectId: string) {
  const job = q.activeJob(projectId);
  if (!job) return null;
  const reason = `stopped by the owner during ${job.stage ?? job.kind}`;
  q.setJob(job.id, { status: "canceled", error: reason });
  release(job.id);
  releaseProject(projectId, job.id, reason);
  return job;
}
