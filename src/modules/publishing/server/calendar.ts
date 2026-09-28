import { db } from "../../../common/server/db";
import { CalendarQuery, Publication } from "../types";
import { dayInZone } from "../lib/resolve";
import { calendarInstant } from "../lib/calendar";
import { detail } from "./service";
import * as store from "./store";

export function calendar(raw: unknown) {
  const query = CalendarQuery.parse(raw), timezone = store.settings().timezone;
  if (query.to < query.from || Date.parse(query.to) - Date.parse(query.from) > 93 * 86400_000) throw new Error("Choose a calendar range of at most 93 days");
  // SQLite filters the candidate range before loading project state or rendering details.
  const rows = db.prepare(`SELECT document FROM publishing_records p WHERE kind='publication'
    AND COALESCE(json_extract(document,'$.archived'),0)=0
    AND (EXISTS(SELECT 1 FROM json_each(p.document,'$.destinations') d
      WHERE julianday(COALESCE(json_extract(d.value,'$.publishedAt'),json_extract(d.value,'$.confirmedAt'),json_extract(d.value,'$.scheduledAt'),json_extract(p.document,'$.scheduledAt')))
      BETWEEN julianday(?) - 1 AND julianday(?) + 2)
    OR (json_extract(document,'$.scheduledAt') IS NULL AND (json_array_length(p.document,'$.destinations')=0 OR EXISTS(
      SELECT 1 FROM json_each(p.document,'$.destinations') d WHERE COALESCE(json_extract(d.value,'$.publishedAt'),json_extract(d.value,'$.confirmedAt'),json_extract(d.value,'$.scheduledAt')) IS NULL))))
    ORDER BY json_extract(document,'$.createdAt'), id`).all(query.from, query.to) as Array<{ document: string }>;
  const candidates = rows.map(row => Publication.parse(JSON.parse(row.document))).filter(p => {
    if (query.accountId && !p.destinations.some(d => d.accountId === query.accountId)) return false;
    const times = p.destinations.map(d => calendarInstant(p, d)).filter((at): at is string => !!at);
    return !times.length || times.length < p.destinations.length || times.some(at => { const day = dayInZone(at, timezone); return day >= query.from && day <= query.to; });
  });
  const page = candidates.slice(query.offset, query.offset + query.limit);
  return { publications: page.map(detail), accounts: store.accounts(), connections: store.connections(), settings: store.settings(), sessions: store.sessions().filter(s => page.some(p => p.id === s.publicationId)), externalCalendars: store.documents("external-calendar").map(raw => { const value = raw as { connectionId: string; checkedAt: number }; return { connectionId: value.connectionId, checkedAt: value.checkedAt }; }), nextOffset: query.offset + page.length < candidates.length ? query.offset + page.length : null };
}
