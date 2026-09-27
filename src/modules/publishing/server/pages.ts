import { overview } from "./service";
export async function loadPublishing() { return overview(); }

export async function loadCalendar() {
  const { calendar } = await import("./calendar");
  const { dayInZone } = await import("../lib/resolve");
  const { settings } = await import("./store");
  const from = dayInZone(new Date().toISOString(), settings().timezone);
  const to = new Date(Date.parse(`${from}T12:00:00Z`) + 6 * 86400_000).toISOString().slice(0, 10);
  return calendar({ from, to });
}
