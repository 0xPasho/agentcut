export type ImageHit = {
  provider: string;
  id: string;
  title: string;
  /** Full-size file. */
  url: string;
  thumbUrl: string;
  pageUrl: string;
  license: string;
  creator?: string;
  width: number;
  height: number;
  /** 0..1 — how well the title matches the query. See scoreTitle. */
  relevance: number;
};

export interface ImageProvider {
  readonly id: string;
  search(query: string, limit: number): Promise<ImageHit[]>;
}

/**
 * Image licences we will put in someone's published video.
 *
 * GPL/AGPL turn up on Commons for software screenshots. They are software
 * licences carrying copyleft obligations that make no sense for a video overlay,
 * so they are excluded rather than reasoned about per case.
 */
const ALLOWED = [
  /^cc0/i,
  /^public domain/i,
  /^pdm/i,
  /^cc[- ]by(?![- ]nc)/i,
  /^cc[- ]by[- ]sa/i,
  /^attribution/i,
];

export function licenceAllowed(license: string | undefined): boolean {
  if (!license) return false;
  const l = license.trim();
  if (/nc|non[- ]commercial|nd|no[- ]deriv/i.test(l)) return false;
  if (/gpl|agpl|lgpl/i.test(l)) return false;
  return ALLOWED.some((re) => re.test(l));
}

const STOP = new Set(["the", "a", "an", "of", "and", "for", "in", "on", "to", "with"]);

/**
 * Keyword search on both providers happily returns a phone handset for "git
 * worktree". Requiring the title to actually contain the query's words is what
 * separates a usable hit from noise.
 */
export function scoreTitle(title: string, query: string): number {
  const terms = query
    .toLowerCase()
    .split(/\W+/)
    .filter((t) => t.length > 2 && !STOP.has(t));
  if (!terms.length) return 0;
  const hay = title.toLowerCase();
  const hits = terms.filter((t) => hay.includes(t)).length;
  return hits / terms.length;
}

export function needsAttribution(license: string): boolean {
  return !/^cc0|^public domain|^pdm/i.test(license.trim());
}

export function creditLine(hit: ImageHit): string | null {
  if (!needsAttribution(hit.license)) return null;
  const who = hit.creator?.trim() || "Unknown author";
  return `"${hit.title}" by ${who}, ${hit.license} — ${hit.pageUrl}`;
}
