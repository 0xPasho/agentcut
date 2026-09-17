import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { projectDir } from "../config";
import { registerAsset } from "../assets";
import { openverse } from "./openverse";
import { commons } from "./commons";
import { creditLine, type ImageHit } from "./types";
import type { AssetRow } from "../db";

export * from "./types";

const PROVIDERS = [commons, openverse];

/**
 * A wrong image is worse than no image, so a hit has to clear a relevance bar
 * before it is offered at all. Measured against real queries: concrete named
 * things clear it easily, abstract phrases like "git worktree" return nothing,
 * which is the correct answer.
 */
const MIN_RELEVANCE = 0.5;
const MIN_PIXELS = 300;

export async function searchImages(query: string, limit = 12): Promise<ImageHit[]> {
  const results = await Promise.all(
    PROVIDERS.map((p) => p.search(query, limit).catch(() => [] as ImageHit[])),
  );

  return results
    .flat()
    .filter((h) => h.relevance >= MIN_RELEVANCE && h.width >= MIN_PIXELS && h.height >= MIN_PIXELS)
    .sort((a, b) => b.relevance - a.relevance || b.width * b.height - a.width * a.height)
    .slice(0, limit);
}

/** Download one hit into a project and register it with its licence. */
export async function adoptHit(hit: ImageHit, projectId: string): Promise<AssetRow> {
  const res = await fetch(hit.url, { headers: { "User-Agent": "agentcut/0.1 (local clip tool)" } });
  if (!res.ok) throw new Error(`download failed: ${res.status}`);

  const dir = path.join(projectDir(projectId), "assets");
  await fs.mkdir(dir, { recursive: true });

  const ext = (hit.url.match(/\.(jpe?g|png|webp|gif)(?:\?|$)/i)?.[1] ?? "jpg").toLowerCase();
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
 */
export async function resolveQuery(query: string, projectId: string): Promise<AssetRow | null> {
  const hits = await searchImages(query, 5).catch(() => [] as ImageHit[]);
  if (!hits.length) return null;
  try {
    return await adoptHit(hits[0], projectId);
  } catch {
    return null;
  }
}
