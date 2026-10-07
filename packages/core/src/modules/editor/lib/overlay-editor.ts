export const num = (v: number | readonly number[]) => (Array.isArray(v) ? v[0] : (v as number));

/** Accepts "12", "12.5" or "1:05". */
export function parseTime(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  if (s.includes(":")) {
    const [m, sec] = s.split(":");
    const v = Number(m) * 60 + Number(sec);
    return Number.isFinite(v) ? v : null;
  }
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
}
