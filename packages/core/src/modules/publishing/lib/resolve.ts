import type { Copy, Destination, Publication, PublicationStatus } from "../types";

export function resolveCopy(base: Copy, destination: Destination): Copy {
  return { title: destination.overrides.title ?? base.title, description: destination.overrides.description ?? base.description, hashtags: destination.overrides.hashtags ?? base.hashtags };
}
export function caption(copy: Copy): string {
  const tags = [...new Set(copy.hashtags)];
  const existing = new Set((copy.description.match(/#[^\s#]+/gu) ?? []).map(t => t.slice(1)));
  return [copy.description.trim(), tags.filter(t => !existing.has(t)).map(t => `#${t}`).join(" ")].filter(Boolean).join("\n\n");
}
export const intendedTime = (publication: Publication, destination: Destination) => destination.scheduledAt ?? publication.scheduledAt;
export function publicationStatus(publication: Publication, approved: boolean): PublicationStatus {
  const states = publication.destinations.map(d => d.state);
  if (states.length && states.every(s => s === "published")) return "published";
  if (states.includes("published")) return "partial";
  if (states.some(s => ["failed", "unknown", "cancel_pending"].includes(s))) return "attention";
  if (states.includes("sending")) return "publishing";
  const active = states.filter(s => s !== "cancelled");
  if (active.length && active.every(s => s === "scheduled")) return "scheduled";
  if (states.some(s => s === "queued" || s === "scheduled")) return "pending";
  if (states.length && states.every(s => s === "cancelled")) return "cancelled";
  return approved ? "approved" : "draft";
}
export function dayInZone(iso: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(iso));
  const value = (type: string) => parts.find(p => p.type === type)!.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}
