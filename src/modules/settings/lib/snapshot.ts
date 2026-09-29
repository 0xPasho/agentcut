import { SNAPSHOT_EXCLUDED_ROOTS, SNAPSHOT_MEDIA } from "../data";

/** One inclusion rule for export, validation and replacing the destination's data. */
export function snapshotPathAllowed(file: string): boolean {
  const parts = file.split("/");
  if (parts.some(p => !p || p === "." || p === ".." || p.startsWith(".snapshot-")) || /[\\:\x00-\x1f]/.test(file)) return false;
  if ((SNAPSHOT_EXCLUDED_ROOTS as readonly string[]).includes(parts[0])) return false;
  if (/\.(db|sqlite|sqlite3)(-(wal|shm|journal))?$|\.agentcut\.gz$|\.lock$|\.pid$|^\.DS_Store$/i.test(parts.at(-1)!)) return false;
  // Packs and the shared library must retain their own reference footage, music and fonts.
  return parts[0] === "packs" || parts[0] === "library" || !SNAPSHOT_MEDIA.test(file);
}

export function rebaseSnapshotValue(value: unknown, previous: string, next: string, fallback?: { previous: string; next: string }): unknown {
  if (typeof value === "string") {
    if (value === previous) return next;
    if (value.startsWith(`${previous}/`)) return next + value.slice(previous.length);
    if (fallback) return rebaseSnapshotValue(value, fallback.previous, fallback.next);
    return value;
  }
  if (Array.isArray(value)) return value.map(v => rebaseSnapshotValue(v, previous, next, fallback));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rebaseSnapshotValue(v, previous, next, fallback)]));
  return value;
}
