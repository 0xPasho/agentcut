import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { projectDir } from "../config";
import { registerAsset } from "../assets";
import { creditLine, licenceAllowed, scoreTitle, type ImageHit } from "./types";
import type { AssetRow } from "../db";

const UA = "agentcut/0.1 (local clip tool)";

/**
 * A sound found online. Deliberately shaped like {@link ImageHit} minus the pixels: the
 * editor treats a found sound and a found picture the same way — search, adopt into the
 * project, reference the asset id from an edit.
 */
export type AudioHit = {
  provider: string;
  id: string;
  title: string;
  url: string;
  pageUrl: string;
  license: string;
  creator?: string;
  durationSec: number;
  relevance: number;
};

/** What the sound is for. A sting and a bed are different searches, not different providers. */
export type AudioKind = "sfx" | "music";

/** Longer than this is not a sound effect, whatever it is called. */
const MAX_SFX_SEC = 30;
/** Short titles carry fewer words to match on than a photo caption, so the bar is lower. */
const MIN_RELEVANCE = 0.34;

type OpenverseAudio = {
  id: string;
  title?: string;
  url: string;
  foreign_landing_url?: string;
  license?: string;
  license_version?: string;
  creator?: string;
  duration?: number;
};

/** Openverse aggregates CC and public-domain audio as well as images. No API key required. */
export async function searchAudio(query: string, limit = 12, kind: AudioKind = "sfx"): Promise<AudioHit[]> {
  const url =
    `https://api.openverse.org/v1/audio/?q=${encodeURIComponent(query)}` +
    `&page_size=${Math.min(20, Math.max(limit, limit * 2))}&license_type=all-cc,commercial`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`openverse ${res.status}`);
  const json = (await res.json()) as { results?: OpenverseAudio[] };
  return (json.results ?? [])
    .map((r): AudioHit => {
      const license = [r.license?.toUpperCase(), r.license_version].filter(Boolean).join(" ").replace(/^BY/, "CC BY");
      const title = r.title ?? "Untitled";
      return {
        provider: "openverse",
        id: r.id,
        title,
        url: r.url,
        pageUrl: r.foreign_landing_url ?? r.url,
        license,
        creator: r.creator,
        // Openverse reports milliseconds, and omits them for some records.
        durationSec: r.duration ? r.duration / 1000 : 0,
        relevance: scoreTitle(title, query),
      };
    })
    .filter(h => licenceAllowed(h.license) && h.relevance >= MIN_RELEVANCE)
    .filter(h => (kind === "sfx" ? !h.durationSec || h.durationSec <= MAX_SFX_SEC : true))
    // A bed wants the long ones first; a sting wants the short ones.
    .sort((a, b) => b.relevance - a.relevance || (kind === "music" ? b.durationSec - a.durationSec : a.durationSec - b.durationSec))
    .slice(0, limit);
}

const EXT_BY_TYPE: Record<string, string> = {
  "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/wav": "wav", "audio/x-wav": "wav",
  "audio/ogg": "ogg", "audio/flac": "flac", "audio/x-flac": "flac", "audio/mp4": "m4a", "audio/aac": "aac",
};

/** Download one hit into a project and register it with its licence, the way a picture is adopted. */
export async function adoptAudioHit(hit: AudioHit, projectId: string): Promise<AssetRow> {
  const res = await fetch(hit.url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`download failed: ${res.status}`);
  const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  // A landing page comes back 200 text/html. Saved under an .mp3 name it would register,
  // place, and render as silence while reporting success.
  if (type && !type.startsWith("audio/") && !type.startsWith("application/octet-stream")) throw new Error(`download was ${type}, not audio`);
  const dir = path.join(projectDir(projectId), "assets");
  await fs.mkdir(dir, { recursive: true });
  const ext = EXT_BY_TYPE[type] ?? (hit.url.match(/\.(mp3|wav|ogg|flac|m4a|aac)(?:\?|$)/i)?.[1] ?? "mp3").toLowerCase();
  const stem = createHash("sha1").update(hit.url).digest("hex").slice(0, 10);
  const file = path.join(dir, `${hit.provider}-${stem}.${ext}`);
  await fs.writeFile(file, Buffer.from(await res.arrayBuffer()));
  return registerAsset({
    file, kind: "audio", scope: "project", projectId,
    name: hit.title, source: hit.provider, sourceUrl: hit.pageUrl, license: hit.license,
    attribution: creditLine({ ...hit, thumbUrl: hit.url, width: 0, height: 0 } as ImageHit) ?? undefined,
  });
}
