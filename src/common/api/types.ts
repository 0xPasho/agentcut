import type { LogEvent, JobState } from "./client";

/**
 * The project's live feed, shared by everything on the page.
 *
 * A run reports what it is doing line by line — which tool, on what, how it went —
 * and every panel that shows progress reads the same stream. One EventSource per
 * project no matter how many components watch it: the editor's agent panel and the
 * project page would otherwise open one each and see slightly different histories.
 */

export type ProjectStream = {
  events: LogEvent[];
  status: string | null;
  error: string | null;
  revision: number;
  job: JobState | null;
  /** False between an unmount and the reconnect, and before the first message. */
  connected: boolean;
};

export type Entry = { source: EventSource; refs: number; snapshot: ProjectStream; listeners: Set<() => void>; closing?: ReturnType<typeof setTimeout> };
