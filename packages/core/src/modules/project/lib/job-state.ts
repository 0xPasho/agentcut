/**
 * How every interface reads a job row. Kept apart from `client.ts` so server code —
 * the editor tools, the API routes — can agree with the browser without importing
 * the fetch layer.
 */
export type JobState = {
  id: string;
  kind: string;
  status: string;
  stage: string | null;
  progress: number;
  createdAt: number;
};

export const JOB_ACTIVE = (job: JobState | null | undefined) => !!job && (job.status === "running" || job.status === "queued");

/** The stored row as the interfaces see it. One mapper, so every entry point agrees. */
export const jobState = (job: { id: string; kind: string; status: string; stage: string | null; progress: number; created_at: number } | null | undefined): JobState | null =>
  job ? { id: job.id, kind: job.kind, status: job.status, stage: job.stage, progress: job.progress, createdAt: job.created_at } : null;
