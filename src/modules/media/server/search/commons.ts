import type { ImageHit, ImageProvider } from "./types";
import { licenceAllowed, scoreTitle } from "./types";

const UA = "agentcut/0.1 (local clip tool)";

type CommonsPage = {
  title?: string;
  imageinfo?: Array<{
    url?: string;
    thumburl?: string;
    descriptionurl?: string;
    width?: number;
    height?: number;
    extmetadata?: Record<string, { value?: string }>;
  }>;
};

/**
 * Wikimedia Commons. No key. Much better than Openverse for concrete named
 * things — products, companies, places, interfaces — which is exactly the only
 * case where a web image beats a frame from the stream.
 */
export const commons: ImageProvider = {
  id: "commons",

  async search(query, limit) {
    const url =
      `https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*` +
      `&generator=search&gsrsearch=${encodeURIComponent(query)}&gsrnamespace=6` +
      `&gsrlimit=${Math.min(20, limit * 3)}` +
      `&prop=imageinfo&iiprop=url|size|extmetadata&iiurlwidth=640`;

    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (!res.ok) throw new Error(`commons ${res.status}`);
    const json = (await res.json()) as { query?: { pages?: Record<string, CommonsPage> } };

    return Object.values(json.query?.pages ?? {})
      .map((p): ImageHit | null => {
        const ii = p.imageinfo?.[0];
        if (!ii?.url) return null;
        const meta = ii.extmetadata ?? {};
        const title = (p.title ?? "").replace(/^File:/, "").replace(/\.[a-z0-9]+$/i, "");
        const license = strip(meta.LicenseShortName?.value) || "";
        return {
          provider: "commons",
          id: p.title ?? ii.url,
          title,
          url: ii.url,
          thumbUrl: ii.thumburl ?? ii.url,
          pageUrl: ii.descriptionurl ?? ii.url,
          license,
          creator: strip(meta.Artist?.value),
          width: ii.width ?? 0,
          height: ii.height ?? 0,
          relevance: scoreTitle(title, query),
        };
      })
      .filter((h): h is ImageHit => h !== null && licenceAllowed(h.license));
  },
};

/** Commons returns HTML in its metadata fields. */
function strip(html: string | undefined): string | undefined {
  if (!html) return undefined;
  return html.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim() || undefined;
}
