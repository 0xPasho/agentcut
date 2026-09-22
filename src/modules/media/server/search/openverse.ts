import type { ImageHit, ImageProvider } from "./types";
import { licenceAllowed, scoreTitle } from "./types";

const UA = "agentcut/0.1 (local clip tool)";

type OpenverseResult = {
  id: string;
  title?: string;
  url: string;
  thumbnail?: string;
  foreign_landing_url?: string;
  license?: string;
  license_version?: string;
  creator?: string;
  width?: number;
  height?: number;
};

/** Openverse aggregates CC and public-domain images. No API key required. */
export const openverse: ImageProvider = {
  id: "openverse",

  async search(query, limit) {
    const url =
      `https://api.openverse.org/v1/images/?q=${encodeURIComponent(query)}` +
      `&page_size=${Math.min(20, limit * 3)}&license_type=all-cc,commercial`;

    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (!res.ok) throw new Error(`openverse ${res.status}`);
    const json = (await res.json()) as { results?: OpenverseResult[] };

    return (json.results ?? [])
      .map((r): ImageHit => {
        const license = [r.license?.toUpperCase(), r.license_version]
          .filter(Boolean)
          .join(" ")
          .replace(/^BY/, "CC BY");
        const title = r.title ?? "Untitled";
        return {
          provider: "openverse",
          id: r.id,
          title,
          url: r.url,
          thumbUrl: r.thumbnail ?? r.url,
          pageUrl: r.foreign_landing_url ?? r.url,
          license,
          creator: r.creator,
          width: r.width ?? 0,
          height: r.height ?? 0,
          relevance: scoreTitle(title, query),
        };
      })
      .filter((h) => licenceAllowed(h.license));
  },
};
