import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { WORKSPACE, projectDir } from "./config";
import { q, type AssetRow } from "./db";
import { probe } from "./media";

export const LIBRARY = path.join(WORKSPACE, "library");

export type AssetKind = AssetRow["kind"];

export async function ensureLibrary() {
  await Promise.all([
    fs.mkdir(path.join(LIBRARY, "images"), { recursive: true }),
    fs.mkdir(path.join(LIBRARY, "audio"), { recursive: true }),
  ]);
}

/** Paths are stored relative to the workspace so the DB survives a move. */
export const toRel = (abs: string) => path.relative(WORKSPACE, path.resolve(abs));
export const toAbs = (rel: string) => path.join(WORKSPACE, rel);

const IMAGE_EXT = /\.(jpe?g|png|webp|gif|avif)$/i;
const AUDIO_EXT = /\.(mp3|wav|m4a|aac|ogg|flac)$/i;

export function kindFor(file: string): AssetKind | null {
  if (IMAGE_EXT.test(file)) return "image";
  if (AUDIO_EXT.test(file)) return "audio";
  return null;
}

async function sha256(file: string) {
  return createHash("sha256").update(await fs.readFile(file)).digest("hex");
}

export type RegisterInput = {
  file: string;
  kind?: AssetKind;
  scope: "library" | "project";
  projectId?: string;
  name?: string;
  tags?: string;
  source: string;
  sourceUrl?: string;
  license?: string;
  attribution?: string;
};

function reuseAsset(asset: AssetRow, input: RegisterInput): AssetRow {
  if (input.scope === "project" && input.projectId) q.linkAsset(input.projectId, asset.id);
  if (input.scope === "library" && asset.scope !== "library") {
    if (asset.project_id) q.linkAsset(asset.project_id, asset.id);
    q.promoteAsset(asset.id);
    return { ...asset, scope: "library", project_id: null };
  }
  return asset;
}

/**
 * Register a file that is already on disk. Content-hashed, so the same image
 * fetched twice is stored once and re-registration is a no-op.
 */
export async function registerAsset(input: RegisterInput): Promise<AssetRow> {
  const abs = path.resolve(input.file);
  const kind = input.kind ?? kindFor(abs);
  if (!kind) throw new Error(`unsupported asset type: ${path.basename(abs)}`);

  const sha = await sha256(abs);
  const existing = q.assetBySha(sha);
  if (existing) return reuseAsset(existing, input);

  const row: AssetRow = {
    id: `a_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
    kind,
    scope: input.scope,
    project_id: input.scope === "project" ? (input.projectId ?? null) : null,
    path: toRel(abs),
    name: input.name ?? path.basename(abs),
    tags: input.tags ?? "",
    source: input.source,
    source_url: input.sourceUrl ?? null,
    license: input.license ?? null,
    attribution: input.attribution ?? null,
    width: null,
    height: null,
    duration_sec: null,
    sha256: sha,
    created_at: Date.now(),
  };

  // ffprobe reads images too, so one call covers both kinds.
  try {
    const meta = await probe(abs);
    row.width = meta.width || null;
    row.height = meta.height || null;
    row.duration_sec = kind === "audio" ? meta.durationSec || null : null;
  } catch {
    // metadata is a nicety; a file we can't probe is still usable
  }

  try { q.insertAsset(row); }
  catch (error) {
    // Two importers can probe identical bytes concurrently. Reuse the winner.
    const winner = q.assetBySha(sha);
    if (!winner) throw error;
    return reuseAsset(winner, input);
  }
  if (input.scope === "project" && input.projectId) q.linkAsset(input.projectId, row.id);
  return row;
}

/** Pick up anything the user dropped into library/ by hand. */
export async function scanLibrary(): Promise<number> {
  await ensureLibrary();
  let added = 0;
  for (const sub of ["images", "audio"] as const) {
    const dir = path.join(LIBRARY, sub);
    for (const file of await fs.readdir(dir).catch(() => [] as string[])) {
      const abs = path.join(dir, file);
      if (!kindFor(abs)) continue;
      const before = q.assetBySha(await sha256(abs));
      if (before) continue;
      await registerAsset({ file: abs, scope: "library", source: "drop-in" });
      added += 1;
    }
  }
  return added;
}

/**
 * Resolve an EDL reference. New EDLs carry an asset id; older ones carry a bare
 * filename in the project's assets/ folder, and those keep working.
 */
export function resolveAssetPath(ref: string, projectId: string): string {
  const row = q.getAsset(ref);
  if (row) return toAbs(row.path);
  return path.join(projectDir(projectId), "assets", ref);
}

/** Credit lines for every asset a project uses that requires one. */
export function creditsFor(refs: string[]): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const ref of refs) {
    const row = q.getAsset(ref);
    if (!row?.attribution || seen.has(row.id)) continue;
    seen.add(row.id);
    lines.push(row.attribution);
  }
  return lines;
}


/** Shared ingestion for uploads from either interface. Never overwrite an existing library file. */
export async function uploadLibraryAsset(name: string, bytes: Uint8Array): Promise<AssetRow> {
  const kind = kindFor(name);
  if (!kind) throw new Error("Choose a supported image or audio file");
  await ensureLibrary();
  const file = path.join(LIBRARY, kind === "audio" ? "audio" : "images", `${randomUUID()}-${path.basename(name)}`);
  await fs.writeFile(file, bytes);
  return registerAsset({ file, kind, scope: "library", name: path.basename(name), source: "upload" });
}
