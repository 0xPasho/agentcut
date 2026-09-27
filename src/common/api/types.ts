import type { LogEvent, JobState } from "./client";

/**
 * The project's live feed, shared by everything on the page.
 *
 * A run reports what it is doing line by line — which tool, on what, how it went —
 * and every panel that shows progress reads the same feed. One poll per project no
 * matter how many components watch it: the editor's agent panel and the project page
 * would otherwise poll one each and see slightly different histories.
 */

export type ProjectStream = {
  events: LogEvent[];
  status: string | null;
  error: string | null;
  revision: number;
  job: JobState | null;
  /** False before the first answer, and while the server is not answering. */
  connected: boolean;
};

/** One answer from `/api/projects/[id]/events`: the lines after `since`, and the project now. */
export type ProjectEvents = {
  events: LogEvent[];
  cursor: number;
  status: { revision: number; status: string; error: string | null; job: JobState | null };
};

export type Entry = {
  refs: number;
  snapshot: ProjectStream;
  listeners: Set<() => void>;
  cursor: number;
  timer?: ReturnType<typeof setTimeout>;
  closing?: ReturnType<typeof setTimeout>;
  stop: () => void;
};
