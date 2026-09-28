import { CalendarArchive, Account, Connection, Publication } from "../types";
import type { CalendarImportPreview } from "../types";
import { PROVIDER_URLS } from "../data";
import { dayInZone } from "../lib/resolve";
import { calendarInstant } from "../lib/calendar";
import { readEditor } from "../../editor/server/store";
import * as store from "./store";
import {
  parseCalendarArchive,
  portableCalendarPublication,
} from "../lib/calendar-transfer";

export function exportCalendar(): CalendarArchive {
  return store.transaction(() =>
    CalendarArchive.parse({
      format: "agentcut-calendar",
      version: 1,
      exportedAt: new Date().toISOString(),
      timezone: store.settings().timezone,
      publications: store.publications().map(portableCalendarPublication),
      accounts: store.accounts(),
      connections: store.connections(),
    }),
  );
}

function inspect(raw: unknown) {
  const archive = parseCalendarArchive(raw);
  const connections = store.connections(),
    accounts = store.accounts();
  for (const c of archive.connections) {
    const existing = connections.find((item) => item.id === c.id);
    if (existing && existing.provider !== c.provider)
      throw new Error(
        `The connection “${c.name}” conflicts with a local connection.`,
      );
  }
  for (const a of archive.accounts) {
    const existing = accounts.find((item) => item.id === a.id);
    if (
      existing &&
      (existing.connectionId !== a.connectionId ||
        existing.network !== a.network ||
        existing.remoteId !== a.remoteId)
    )
      throw new Error(
        `The account “${a.name}” conflicts with a local account.`,
      );
  }
  const existingIds = new Set(store.publications().map((p) => p.id));
  const entries = archive.publications.filter((p) => !existingIds.has(p.id));
  const timezone = store.settings().timezone;
  let missingVideos = 0;
  for (const p of entries) {
    try {
      const { edl } = readEditor(p.projectId);
      if (
        ![...edl.clips, ...edl.sequences].some(
          (video) => video.id === p.sequenceId,
        )
      )
        missingVideos++;
    } catch {
      missingVideos++;
    }
  }
  const days = entries
    .filter((p) => !p.archived)
    .flatMap((p) =>
      p.destinations.flatMap((d) => {
        const at = calendarInstant(p, d);
        return at ? [dayInZone(at, timezone)] : [];
      }),
    )
    .sort();
  const preview: CalendarImportPreview = {
    total: archive.publications.length,
    added: entries.length,
    skipped: archive.publications.length - entries.length,
    reconnect: archive.accounts.filter(
      (a) => !accounts.some((existing) => existing.id === a.id),
    ).length,
    missingVideos,
    uncertain: entries.filter((p) =>
      p.destinations.some((d) =>
        ["queued", "sending", "cancel_pending"].includes(d.state),
      ),
    ).length,
    timezone: archive.timezone,
    firstDay: days[0] ?? null,
  };
  return { archive, entries, preview, accounts, connections };
}

export function previewCalendarImport(raw: unknown): CalendarImportPreview {
  return inspect(raw).preview;
}

/** Append only, in one transaction. A transferred queue never starts a delivery. */
export function importCalendar(raw: unknown): CalendarImportPreview {
  return store.transaction(() => {
    const { archive, entries, preview, accounts, connections } = inspect(raw);
    for (const c of archive.connections)
      if (!connections.some((existing) => existing.id === c.id)) {
        store.put(
          "connection",
          c.id,
          Connection.parse({
            ...c,
            baseUrl: PROVIDER_URLS[c.provider],
            configured: c.provider === "iphone",
          }),
        );
      }
    for (const a of archive.accounts)
      if (!accounts.some((existing) => existing.id === a.id)) {
        store.put(
          "account",
          a.id,
          Account.parse({ ...a, needsReconnect: true }),
        );
      }
    for (const entry of entries) {
      const p = portableCalendarPublication(entry);
      for (const d of p.destinations)
        if (["queued", "sending", "cancel_pending"].includes(d.state)) {
          d.state = "unknown";
          d.error =
            "Imported while delivery was in progress. Verify the result in the publishing app before retrying.";
        }
      store.savePublication(Publication.parse(p));
    }
    return preview;
  });
}
