import { Publication } from "../types";
import { calendarTime } from "./calendar";
import { dayInZone } from "./resolve";
import { localInstant } from "./schedule";

/** Keep the exact saved instant, including seconds and a DST fold's offset, until edited. */
export function resolveTimeField(day: string, time: string, timezone: string, previous: string | null): string {
  if (!day || !time) throw new Error("Choose a date and time.");
  if (previous && dayInZone(previous, timezone) === day && calendarTime(previous, timezone) === time) return previous;
  return localInstant(day, time, timezone);
}

export function resolveTimeFieldTimestamp(value: string): string {
  const result = Publication.shape.scheduledAt.safeParse(value);
  if (!result.success || !result.data) throw new Error("Enter a timestamp with its UTC offset, like 2026-10-01T18:00:00-06:00.");
  return result.data;
}
