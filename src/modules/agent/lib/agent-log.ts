import type { LogEvent } from "../../../common/api/client";

export const time = (at: number) => new Date(at).toTimeString().slice(0, 8);

/**
 * Provider stderr and unnamed log lines are noise in a progress line: what the run
 * is doing is its tool calls, its stages, what it says and what failed.
 */
export const isActivity = (e: LogEvent) => e.kind !== "log" || !!e.name;
