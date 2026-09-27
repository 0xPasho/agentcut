/** Calendar arithmetic uses civil dates; the caller chooses the workspace timezone. */
export function calendarDates(anchor: string, view: string): string[] {
  const date = new Date(`${anchor}T12:00:00Z`);
  if (!Number.isFinite(date.getTime())) return [];
  let count = 7;
  if (view === "month") {
    date.setUTCDate(1);
    const monthEnd = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0, 12));
    const offset = (date.getUTCDay() + 6) % 7;
    count = Math.ceil((offset + monthEnd.getUTCDate()) / 7) * 7;
    date.setUTCDate(1 - offset);
  }
  return Array.from({ length: count }, (_, n) => new Date(date.getTime() + n * 86400_000).toISOString().slice(0, 10));
}
export function adjacentPeriod(anchor: string, view: string, step: number): string {
  const date = new Date(`${anchor}T12:00:00Z`);
  if (view === "month") { date.setUTCDate(1); date.setUTCMonth(date.getUTCMonth() + step); }
  else date.setUTCDate(date.getUTCDate() + step * 7);
  return date.toISOString().slice(0, 10);
}
