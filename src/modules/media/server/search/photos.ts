import { providerKey } from "../../../../common/server/secrets";
import type { ImageHit, ImageProvider } from "./types";

const UA = "agentcut/0.1 (local clip tool)";

/**
 * Commons and Openverse are keyword dumps, so the local title score is the only
 * thing standing between a query and a wrong picture. These three are ranked by
 * the service itself, and their titles are often empty, so rank *is* the score —
 * it just decays so a first-choice CC0 photograph still outranks a fourth-choice one.
 */
const byRank = (index: number, limit: number) => Math.max(0.6, 1 - (index / Math.max(1, limit)) * 0.4);

type PexelsPhoto = {
  id: number; width?: number; height?: number; alt?: string; url?: string; photographer?: string;
  src?: { original?: string; large2x?: string; large?: string; medium?: string };
};

/** Real, free-to-use stock photographs. Needs a free key: https://www.pexels.com/api/ */
export const pexels: ImageProvider = {
  id: "pexels",
  async search(query, limit) {
    const key = providerKey("pexels");
    if (!key) return [];
    const res = await fetch(
      `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=${Math.min(30, limit * 2)}`,
      { headers: { Authorization: key, "User-Agent": UA } },
    );
    if (!res.ok) throw new Error(`pexels ${res.status}`);
    const json = (await res.json()) as { photos?: PexelsPhoto[] };
    return (json.photos ?? []).flatMap((photo, index): ImageHit[] => {
      const url = photo.src?.large2x ?? photo.src?.original ?? photo.src?.large;
      if (!url) return [];
      return [{
        provider: "pexels", id: String(photo.id), title: photo.alt?.trim() || query,
        url, thumbUrl: photo.src?.medium ?? url, pageUrl: photo.url ?? url,
        license: "Pexels License", creator: photo.photographer,
        width: photo.width ?? 0, height: photo.height ?? 0, relevance: byRank(index, limit),
      }];
    });
  },
};

type UnsplashPhoto = {
  id: string; width?: number; height?: number; description?: string | null; alt_description?: string | null;
  urls?: { raw?: string; full?: string; regular?: string; small?: string };
  links?: { html?: string }; user?: { name?: string };
};

/** Free-to-use photographs. Needs a free key: https://unsplash.com/developers */
export const unsplash: ImageProvider = {
  id: "unsplash",
  async search(query, limit) {
    const key = providerKey("unsplash");
    if (!key) return [];
    const res = await fetch(
      `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=${Math.min(30, limit * 2)}`,
      { headers: { Authorization: `Client-ID ${key}`, "User-Agent": UA } },
    );
    if (!res.ok) throw new Error(`unsplash ${res.status}`);
    const json = (await res.json()) as { results?: UnsplashPhoto[] };
    return (json.results ?? []).flatMap((photo, index): ImageHit[] => {
      const url = photo.urls?.regular ?? photo.urls?.full ?? photo.urls?.raw;
      if (!url) return [];
      return [{
        provider: "unsplash", id: photo.id,
        title: (photo.description ?? photo.alt_description ?? "").trim() || query,
        url, thumbUrl: photo.urls?.small ?? url, pageUrl: photo.links?.html ?? url,
        license: "Unsplash License", creator: photo.user?.name,
        width: photo.width ?? 0, height: photo.height ?? 0, relevance: byRank(index, limit),
      }];
    });
  },
};

type CseItem = {
  title?: string; link?: string; displayLink?: string;
  image?: { thumbnailLink?: string; contextLink?: string; width?: number; height?: number };
};

/**
 * Google image search, through the official Programmable Search Engine JSON API —
 * the only way to query Google's index without scraping it. Needs a key and an
 * engine ID with "Search the entire web" and image search turned on.
 *
 * Google indexes the whole web, so a result carries no licence with it. Results are
 * restricted to Creative Commons rights by default, and the licence is still reported
 * as unverified: a Google hit is a lead to check, not a cleared asset.
 */
export const googleImages: ImageProvider = {
  id: "google",
  async search(query, limit) {
    const key = providerKey("google");
    const cx = providerKey("googleCx");
    if (!key || !cx) return [];
    const rights = process.env.AGENTCUT_GOOGLE_CSE_RIGHTS ?? "cc_publicdomain|cc_attribute|cc_sharealike";
    const res = await fetch(
      `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(key)}&cx=${encodeURIComponent(cx)}` +
        `&q=${encodeURIComponent(query)}&searchType=image&num=${Math.min(10, Math.max(1, limit))}` +
        (rights && rights !== "any" ? `&rights=${encodeURIComponent(rights)}` : ""),
      { headers: { "User-Agent": UA } },
    );
    if (!res.ok) throw new Error(`google ${res.status}`);
    const json = (await res.json()) as { items?: CseItem[] };
    return (json.items ?? []).flatMap((item, index): ImageHit[] => {
      if (!item.link) return [];
      return [{
        provider: "google", id: item.link, title: item.title?.trim() || query,
        url: item.link, thumbUrl: item.image?.thumbnailLink ?? item.link,
        pageUrl: item.image?.contextLink ?? item.link,
        license: "Unverified web result", creator: item.displayLink,
        width: item.image?.width ?? 0, height: item.image?.height ?? 0, relevance: byRank(index, limit),
      }];
    });
  },
};

/** Which optional providers this machine is actually configured for. */
export function configuredKeyedProviders(): string[] {
  return [
    providerKey("pexels") ? "pexels" : null,
    providerKey("unsplash") ? "unsplash" : null,
    providerKey("google") && providerKey("googleCx") ? "google" : null,
  ].filter((id): id is string => id !== null);
}
