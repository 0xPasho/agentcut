import { overview } from "./service";
export async function loadPublishing() { return overview(); }

export async function loadCalendar() {
  const { calendar } = await import("./calendar");
  const { dayInZone } = await import("../lib/resolve");
  const { settings } = await import("./store");
  const from = dayInZone(new Date().toISOString(), settings().timezone);
  const { calendarDates } = await import("../lib/calendar");
  const dates = calendarDates(from, "month");
  return calendar({ from: dates[0], to: dates.at(-1)! });
}
