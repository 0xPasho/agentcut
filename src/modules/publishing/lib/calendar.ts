import type { CalendarPlacement, Destination, Publication } from "../types";
import { dayInZone, intendedTime } from "./resolve";
import { localInstant } from "./schedule";

export function calendarInstant(p: Publication, d: Destination): string | null {
  return d.publishedAt ?? d.confirmedAt ?? intendedTime(p, d);
}

export function calendarTime(at: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(at));
}

export function calendarDestinations(p: Publication, date: string | null, timezone: string, accountId = ""): Destination[] {
  return p.destinations.filter(d => {
    if (accountId && d.accountId !== accountId) return false;
    const at = calendarInstant(p, d);
    return date ? !!at && dayInZone(at, timezone) === date : !at;
  });
}

export function calendarPlacements(p: Publication, destinationIds: string[], day: string, timezone: string, time?: string): CalendarPlacement[] {
  return destinationIds.map(destinationId => {
    const d = p.destinations.find(d => d.id === destinationId);
    if (!d) throw new Error("Destination not found");
    const before = d.confirmedAt ?? intendedTime(p, d);
    if (!before && !time) throw new Error("Choose a publication time");
    return { destinationId, at: localInstant(day, time || calendarTime(before!, timezone), timezone) };
  });
}

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

/** Use the same civil range as the calendar, including weeks spanning months or years. */
export function calendarPeriodLabel(anchor: string, view: string, locale?: string): string {
  const date = new Date(`${anchor}T12:00:00Z`);
  if (view === "month") {
    return new Intl.DateTimeFormat(locale, {
      month: "long", year: "numeric", timeZone: "UTC",
    }).format(date);
  }
  const dates = calendarDates(anchor, view);
  return new Intl.DateTimeFormat(locale, {
    month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
  }).formatRange(date, new Date(`${dates.at(-1)}T12:00:00Z`));
}
