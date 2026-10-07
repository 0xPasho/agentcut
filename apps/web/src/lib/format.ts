const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
const STEPS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 365 * 86400_000],
  ["month", 30 * 86400_000],
  ["week", 7 * 86400_000],
  ["day", 86400_000],
  ["hour", 3600_000],
  ["minute", 60_000],
];

export function timeAgo(ms: number, now = Date.now()): string {
  const diff = ms - now;
  for (const [unit, size] of STEPS) {
    if (Math.abs(diff) >= size) return rtf.format(Math.round(diff / size), unit);
  }
  return "just now";
}

export function isoDate(ms: number): string {
  return new Date(ms).toISOString();
}

export function longDate(ms: number): string {
  return new Intl.DateTimeFormat("en", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }).format(ms);
}

export function count(n: number): string {
  return new Intl.NumberFormat("en", { notation: n >= 10_000 ? "compact" : "standard" }).format(n);
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function plural(n: number, one: string, many: string): string {
  return `${count(n)} ${n === 1 ? one : many}`;
}
