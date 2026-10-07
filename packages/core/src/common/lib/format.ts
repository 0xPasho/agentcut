/**
 * Durations as a person reads them, not as the editor measures them.
 *
 * `fmt` in transcript.ts is the editor's ruler: centiseconds, because a trim
 * handle lands between frames. An overview card is not a ruler — "2:27.73" and
 * "15799s" are both precise and both unreadable at a glance.
 */
export function runtime(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

/** "3 shots", "1 shot" — a full string per case, never a fragment glued to a number. */
export function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}
