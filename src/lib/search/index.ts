import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { projectDir } from "../config";
import { registerAsset } from "../assets";
import { openverse } from "./openverse";
import { commons } from "./commons";
import { brand } from "./brand";
import { pexels, unsplash, googleImages, configuredKeyedProviders } from "./photos";
import { creditLine, type ImageHit, type ImageProvider } from "./types";
import type { AssetRow } from "../db";

export * from "./types";
export { findBrand, brandsInText, brandHit, brandKey, brandIndex, resetBrandIndex, type Brand } from "./brand";
export { configuredKeyedProviders } from "./photos";

/**
 * Ordered by how specific the answer is. A brand name wants its own mark, not a
 * photograph of a shop sign, so `brand` is offered first and only ever answers
 * when the query *is* a brand. Keyed providers return nothing without their key,
 * which is why they can sit in the list unconditionally.
 */
const PROVIDERS: ImageProvider[] = [brand, commons, openverse, pexels, unsplash, googleImages];

export type ProviderInfo = { id: string; label: string; kind: "logo" | "photo" | "web"; configured: boolean; note: string };

export function listProviders(): ProviderInfo[] {
  const keyed = new Set(configuredKeyedProviders());
  return [
    { id: "brand", label: "Brand logos", kind: "logo", configured: true, note: "Official marks for ~3,400 companies and products (Simple Icons, CC0). Answers only when the query names a brand." },
    { id: "commons", label: "Wikimedia Commons", kind: "photo", configured: true, note: "Free-licence photographs and diagrams of named things. No key." },
    { id: "openverse", label: "Openverse", kind: "photo", configured: true, note: "Creative Commons image aggregator. No key." },
    { id: "pexels", label: "Pexels", kind: "photo", configured: keyed.has("pexels"), note: "Stock photography. Set AGENTCUT_PEXELS_KEY." },
    { id: "unsplash", label: "Unsplash", kind: "photo", configured: keyed.has("unsplash"), note: "Stock photography. Set AGENTCUT_UNSPLASH_KEY." },
    { id: "google", label: "Google Images", kind: "web", configured: keyed.has("google"), note: "Google Programmable Search. Set AGENTCUT_GOOGLE_CSE_KEY and AGENTCUT_GOOGLE_CSE_CX. Results carry no verified licence." },
  ];
}

/**
 * A wrong image is worse than no image, so a hit has to clear a relevance bar
 * before it is offered at all. Measured against real queries: concrete named
 * things clear it easily, abstract phrases like "git worktree" return nothing,
 * which is the correct answer.
 */
const MIN_RELEVANCE = 0.5;
const MIN_PIXELS = 300;

/** Why a search came back thin: a provider that failed is not the same as a query with no answer. */
export type SearchDiagnostics = { hits: ImageHit[]; failures: Array<{ provider: string; message: string }> };

export async function searchImagesDetailed(query: string, limit = 12, providers?: string[]): Promise<SearchDiagnostics> {
  const chosen = providers?.length ? PROVIDERS.filter((p) => providers.includes(p.id)) : PROVIDERS;
  const failures: Array<{ provider: string; message: string }> = [];
  // Asking for a provider by name and getting silence sends the author tuning
  // salience when the real problem is a typo or a missing key. Name it.
  if (providers?.length) {
    const known = new Map(listProviders().map((p) => [p.id, p]));
    for (const id of providers) {
      const info = known.get(id);
      if (!info) failures.push({ provider: id, message: `unknown image provider "${id}"; known: ${[...known.keys()].join(", ")}` });
      else if (!info.configured) failures.push({ provider: id, message: info.note });
    }
  }
  const results = await Promise.all(
    chosen.map((p) => p.search(query, limit).catch((error: Error) => {
      // One provider being down must not take the others with it, but it must not
      // look like "nothing matched" either: an expired key would be invisible.
      failures.push({ provider: p.id, message: error.message });
      console.error(`Image provider ${p.id} failed: ${error.message}`);
      return [] as ImageHit[];
    })),
  );

  return { failures, hits: results
    .flat()
    .filter((h) => h.relevance >= MIN_RELEVANCE && h.width >= MIN_PIXELS && h.height >= MIN_PIXELS)
    // A logo answers first. It only ever appears when the query *is* a brand name,
    // and in that case a keyword match on a photo archive is the wrong answer however
    // large the file: searching Commons for "Google" leads with a carpet from Google
    // Art Project, which scores 1.0 on the title and illustrates nothing.
    .sort((a, b) =>
      Number(b.provider === "brand") - Number(a.provider === "brand") ||
      b.relevance - a.relevance ||
      b.width * b.height - a.width * a.height)
    .slice(0, limit) };
}

export async function searchImages(query: string, limit = 12, providers?: string[]): Promise<ImageHit[]> {
  return (await searchImagesDetailed(query, limit, providers)).hits;
}

/** Content type decides the extension: a CDN that serves an SVG from an extensionless URL is normal. */
const EXT_BY_TYPE: Record<string, string> = {
  "image/svg+xml": "svg", "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp",
  "image/gif": "gif", "image/avif": "avif",
};

/** Download one hit into a project and register it with its licence. */
export async function adoptHit(hit: ImageHit, projectId: string): Promise<AssetRow> {
  const res = await fetch(hit.url, { headers: { "User-Agent": "agentcut/0.1 (local clip tool)" } });
  if (!res.ok) throw new Error(`download failed: ${res.status}`);

  const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  // A hotlink-protection page comes back 200 text/html. Saved under a .jpg name it
  // would register, place, and render as a broken picture while reporting success.
  if (type && !type.startsWith("image/")) throw new Error(`download was ${type}, not an image`);

  const dir = path.join(projectDir(projectId), "assets");
  await fs.mkdir(dir, { recursive: true });

  const ext = EXT_BY_TYPE[type] ?? (hit.url.match(/\.(jpe?g|png|webp|gif|avif|svg)(?:\?|$)/i)?.[1] ?? "jpg").toLowerCase();
  const stem = createHash("sha1").update(hit.url).digest("hex").slice(0, 10);
  const file = path.join(dir, `${hit.provider}-${stem}.${ext}`);
  await fs.writeFile(file, Buffer.from(await res.arrayBuffer()));

  return registerAsset({
    file,
    kind: "image",
    scope: "project",
    projectId,
    name: hit.title,
    source: hit.provider,
    sourceUrl: hit.pageUrl,
    license: hit.license,
    attribution: creditLine(hit) ?? undefined,
  });
}

/**
 * Resolve an agent's `query` into a concrete asset. Returns null when nothing
 * clears the bar — the caller then drops the overlay rather than showing junk.
 * `reason` separates "no picture exists for this" from "the search itself broke",
 * which are the same outcome on screen and completely different to act on.
 */
export async function resolveQueryDetailed(
  query: string,
  projectId: string,
  providers?: string[],
): Promise<{ asset: AssetRow | null; reason: "found" | "no-match" | "search-failed" | "download-failed"; detail?: string }> {
  const { hits, failures } = await searchImagesDetailed(query, 5, providers);
  const downloads: string[] = [];
  for (const hit of hits) {
    try { return { asset: await adoptHit(hit, projectId), reason: "found" }; }
    catch (error) { downloads.push(`${hit.provider}: ${(error as Error).message}`); }
  }
  if (hits.length) return { asset: null, reason: "download-failed", detail: downloads.join("; ") };
  if (failures.length) return { asset: null, reason: "search-failed", detail: failures.map((f) => `${f.provider}: ${f.message}`).join("; ") };
  return { asset: null, reason: "no-match" };
}

export async function resolveQuery(query: string, projectId: string, providers?: string[]): Promise<AssetRow | null> {
  return (await resolveQueryDetailed(query, projectId, providers)).asset;
}
export { searchAudio, adoptAudioHit, type AudioHit, type AudioKind } from "./audio";
