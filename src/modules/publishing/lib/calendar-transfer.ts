import { CalendarArchive } from "../types";
import type { Publication } from "../types";

export function portableCalendarPublication(p: Publication): Publication {
  return {
    ...p,
    artifactId: null,
    phoneSource: null,
    destinations: p.destinations.map((d) => ({
      ...d,
      payload: null,
      payloadHash: null,
      evidence: [],
    })),
  };
}

function unique(ids: string[], label: string) {
  if (ids.some((id) => !id.trim()) || new Set(ids).size !== ids.length)
    throw new Error(
      `The calendar file contains empty or duplicate ${label}. Export it again from the original computer.`,
    );
}

export function parseCalendarArchive(raw: unknown): CalendarArchive {
  const parsed = CalendarArchive.safeParse(raw);
  if (!parsed.success)
    throw new Error(
      "Choose an Agentcut calendar JSON file exported by a supported version.",
    );
  const archive = parsed.data;
  unique(
    archive.publications.map((p) => p.id),
    "publications",
  );
  unique(
    archive.accounts.map((a) => a.id),
    "accounts",
  );
  unique(
    archive.connections.map((c) => c.id),
    "connections",
  );
  new Intl.DateTimeFormat("en", { timeZone: archive.timezone });
  for (const a of archive.accounts) {
    if (!archive.connections.some((c) => c.id === a.connectionId))
      throw new Error(`The file is missing the connection for “${a.name}”.`);
    if (
      a.equivalentTo &&
      !archive.accounts.some(
        (other) =>
          other.id === a.equivalentTo &&
          other.id !== a.id &&
          other.network === a.network &&
          !other.equivalentTo,
      )
    )
      throw new Error(`The linked account for “${a.name}” is invalid.`);
  }
  for (const p of archive.publications) {
    new Intl.DateTimeFormat("en", { timeZone: p.timezone });
    unique(
      p.destinations.map((d) => d.id),
      "destinations",
    );
    unique(
      p.destinations.map((d) => d.accountId),
      "destination accounts",
    );
    for (const d of p.destinations) {
      if (!archive.accounts.some((a) => a.id === d.accountId))
        throw new Error(`The file is missing an account for “${p.label}”.`);
      for (const at of [d.confirmedAt, d.publishedAt])
        if (at && !Number.isFinite(Date.parse(at)))
          throw new Error(
            `The file contains an invalid date for “${p.label}”.`,
          );
    }
  }
  return archive;
}
