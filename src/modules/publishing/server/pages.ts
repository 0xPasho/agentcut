import { q } from "../../../common/server/db";
import type { CalendarPageData } from "../types";
import { overview } from "./service";
export async function loadPublishing() { return overview(); }

export async function loadCalendar(params: { projectId?: string | string[] } = {}): Promise<CalendarPageData | null> {
  if (Array.isArray(params.projectId)) return null;
  const project = params.projectId ? q.getProject(params.projectId) : null;
  if (params.projectId && !project) return null;
  const { calendar } = await import("./calendar");
  const { dayInZone } = await import("../lib/resolve");
  const { settings } = await import("./store");
  const from = dayInZone(new Date().toISOString(), settings().timezone);
  const { calendarDates } = await import("../lib/calendar");
  const dates = calendarDates(from, "month");
  return {
    initial: calendar({ from: dates[0], to: dates.at(-1)!, projectId: project?.id }),
    project: project ? { id: project.id, name: project.name } : null,
  };
}
