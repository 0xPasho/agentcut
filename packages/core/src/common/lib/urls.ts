/** A link, as both the browser and the server judge it. Kept apart from `ingest.ts` so client code can ask. */
export function isUrl(s: string) {
  return /^https?:\/\//i.test(s);
}
