import type { ProjectSummary } from "../../../common/api/client";

/** A project row as the home list shows it: counts read from its saved edit list. */
export function projectSummary(row: { id: string; name: string; status: string; created_at: number; edl: string | null }): ProjectSummary {
  if (!row.edl) return { id: row.id, name: row.name, status: row.status, createdAt: row.created_at, sequenceCount: 0, clipCount: 0 };
  const edl = JSON.parse(row.edl) as { sequences?: unknown[]; clips?: unknown[] };
  return {
    id: row.id, name: row.name, status: row.status, createdAt: row.created_at,
    sequenceCount: edl.sequences?.length ?? 0,
    clipCount: edl.clips?.length ?? 0,
  };
}
