import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { ROOT, WORKSPACE, projectDir } from "./config";
import { q, type AssetRow } from "./db";
import { probe } from "./media";

export const LIBRARY = path.join(WORKSPACE, "library");

export type AssetKind = AssetRow["kind"];

export async function ensureLibrary() {
  await Promise.all([
    fs.mkdir(path.join(LIBRARY, "images"), { recursive: true }),
    fs.mkdir(path.join(LIBRARY, "audio"), { recursive: true }),
    fs.mkdir(path.join(LIBRARY, "video"), { recursive: true }),
  ]);
}

/** Where a kind lives inside the library. */
export const libraryDirFor = (kind: AssetKind) => path.join(LIBRARY, kind === "audio" ? "audio" : kind === "video" ? "video" : "images");

/** Paths are stored relative to the workspace so the DB survives a move. */
export const toRel = (abs: string) => path.relative(WORKSPACE, path.resolve(abs));
export const toAbs = (rel: string) => path.join(WORKSPACE, rel);

const IMAGE_EXT = /\.(jpe?g|png|webp|gif|avif|svg)$/i;
const AUDIO_EXT = /\.(mp3|wav|m4a|aac|ogg|flac)$/i;
/** Reusable footage — intros, outros, stings, b-roll — lives in the library like any other asset. */
const VIDEO_EXT = /\.(mp4|mov|mkv|webm|m4v)$/i;

export function kindFor(file: string): AssetKind | null {
  if (IMAGE_EXT.test(file)) return "image";
  if (AUDIO_EXT.test(file)) return "audio";
  if (VIDEO_EXT.test(file)) return "video";
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
    row.duration_sec = kind === "audio" || kind === "video" ? meta.durationSec || null : null;
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

/**
 * The handful of sounds that ship with the app — a whoosh, a ding, an impact.
 *
 * They are synthesised (see `scripts/make-sfx.mjs`), so they carry no licence and need
 * no network, and they are copied into the library rather than referenced from it, which
 * makes them ordinary assets: renameable, usable by the agent, and deletable for good.
 * The marker is what makes deleting one stick.
 */
const STARTER_MARKER = ".starter-sounds";
export const STARTER_SOUNDS = ["whoosh", "ding", "pop", "impact", "riser", "click", "swipe", "sparkle"] as const;

export async function installStarterSounds(): Promise<number> {
  await ensureLibrary();
  const dir = libraryDirFor("audio");
  const marker = path.join(dir, STARTER_MARKER);
  if (await fs.stat(marker).then(() => true, () => false)) return 0;
  let added = 0;
  for (const name of STARTER_SOUNDS) {
    const from = path.join(ROOT, "public", "sfx", `${name}.mp3`);
    const to = path.join(dir, `${name}.mp3`);
    try {
      await fs.copyFile(from, to, fs.constants?.COPYFILE_EXCL ?? 1);
      await registerAsset({ file: to, kind: "audio", scope: "library", name: name[0].toUpperCase() + name.slice(1), tags: "sfx,starter", source: "starter" });
      added += 1;
    } catch {
      // Already there, or shipped without the files: neither is worth failing a library read over.
    }
  }
  await fs.writeFile(marker, `${STARTER_SOUNDS.join("\n")}\n`);
  return added;
}

/** Pick up anything the user dropped into library/ by hand. */
export async function scanLibrary(): Promise<number> {
  await ensureLibrary();
  // The starter sounds are not something the user dropped in, so they are not counted
  // as such: the number this returns answers "what did I just pick up from my folder".
  await installStarterSounds();
  let added = 0;
  for (const sub of ["images", "audio", "video"] as const) {
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
  if (!kind) throw new Error("Choose a supported image, audio or video file");
  await ensureLibrary();
  const file = path.join(libraryDirFor(kind), `${randomUUID()}-${path.basename(name)}`);
  await fs.writeFile(file, bytes);
  return registerAsset({ file, kind, scope: "library", name: path.basename(name), source: "upload" });
}
