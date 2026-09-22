import type { LogEvent } from "../../../common/api/client";

export const formatElapsed = (seconds: number) => {
  if (seconds >= 3600) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

export const took = (events: LogEvent[]) => Math.max(0, Math.round((events[events.length - 1].at - events[0].at) / 1000));
