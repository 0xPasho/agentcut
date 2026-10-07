import type { Occupancy, PublishingSettings, SlotPlan, SlotRequest } from "../types";

/** Search offsets rather than assuming a fixed UTC offset. Ambiguous/gap times are refused. */
export function localInstant(day: string, time: string, timezone: string): string {
  const wall = `${day}T${time}:00`;
  const guess = Date.parse(`${wall}Z`);
  if (!Number.isFinite(guess)) throw new Error("Invalid date or time");
  const f = new Intl.DateTimeFormat("sv-SE", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const matches: string[] = [];
  // Modern IANA offsets are multiples of 15 minutes. Evaluate ±14h to include all.
  for (let offset = -14 * 60; offset <= 14 * 60; offset += 15) {
    const date = new Date(guess + offset * 60_000);
    if (f.format(date).replace(" ", "T") === wall.slice(0, 16)) matches.push(date.toISOString());
  }
  if (matches.length !== 1) throw new Error(matches.length ? "This local time occurs twice. Choose an explicit UTC offset." : "This local time does not exist. Choose another time.");
  return matches[0];
}
export function planSlots(requests: SlotRequest[], settings: PublishingSettings, occupancy: Occupancy[], from: string, days: number, now = Date.now()): SlotPlan {
  const placements: SlotPlan["placements"] = [], unavailable: SlotPlan["unavailable"] = [];
  const taken = occupancy.filter(o => !requests.some(r => r.publicationId === o.publicationId));
  const candidates: string[] = [];
  for (let n = 0; n < Math.min(days, 90); n++) {
    const day = new Date(Date.parse(`${from}T12:00:00Z`) + n * 86400_000);
    for (const slot of settings.slots.filter(s => s.weekday === day.getUTCDay())) {
      try { candidates.push(localInstant(day.toISOString().slice(0, 10), slot.time, settings.timezone)); } catch { /* DST gaps/folds are never silently shifted. */ }
    }
  }
  candidates.sort();
  const sorted = [...requests].sort((a, b) => b.priority - a.priority || (a.expiresAt ?? "9999").localeCompare(b.expiresAt ?? "9999") || a.publicationId.localeCompare(b.publicationId));
  for (const request of sorted) {
    const at = candidates.find(iso => {
      const t = Date.parse(iso);
      return request.accountIds.length > 0 && t >= now + settings.leadMinutes * 60_000 && (!request.expiresAt || t < Date.parse(request.expiresAt)) && !taken.some(o => request.accountIds.includes(o.accountId) && Math.abs(Date.parse(o.at) - t) < settings.minGapMinutes * 60_000);
    });
    if (!at) { unavailable.push({ publicationId: request.publicationId, reason: "No common free slot before expiry in the selected range. Check accounts, weekly times and spacing." }); continue; }
    placements.push({ publicationId: request.publicationId, at });
    for (const accountId of request.accountIds) taken.push({ accountId, at, publicationId: request.publicationId });
  }
  return { placements, unavailable };
}
