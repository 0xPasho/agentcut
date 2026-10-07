import type { D1Database, D1PreparedStatement, R2Bucket } from "../cf";
import { PackManifest } from "@agentcut/core/modules/packs/types";
import type { User } from "../env";
import { decodeBase64 } from "./crypto";
import { VERSION_RE, compareVersions, highest } from "./semver";

export const MAX_TOTAL_BYTES = 50 * 1024 * 1024;
export const MAX_FILES = 2000;

export type PackCounts = { templates: number; rules: number; assets: number; recipes: number };

export type PackListing = {
  name: string;
  title: string;
  description: string;
  latest: string;
  author: string;
  owner: { login: string; avatarUrl: string | null };
  downloads: number;
  updatedAt: number;
  source: string;
  counts: PackCounts;
};

export type PackVersion = { version: string; publishedAt: number; size: number };

export type PackDetail = PackListing & { versions: PackVersion[]; manifest: PackManifest };

type PackRow = {
  name: string;
  title: string;
  description: string;
  author: string;
  latest: string;
  downloads: number;
  updated_at: number;
  templates: number;
  rules: number;
  assets: number;
  recipes: number;
  owner_login: string;
  owner_avatar: string | null;
};

const PACK_SELECT = `SELECT p.name, p.title, p.description, p.author, p.latest, p.downloads, p.updated_at,
  p.templates, p.rules, p.assets, p.recipes, u.login AS owner_login, u.avatar_url AS owner_avatar
  FROM packs p JOIN users u ON u.id = p.owner_id`;

export const sourceUrl = (origin: string, name: string, version: string) => `${origin}/r/${name}/${version}`;

function toListing(row: PackRow, origin: string): PackListing {
  return {
    name: row.name,
    title: row.title,
    description: row.description,
    latest: row.latest,
    author: row.author,
    owner: { login: row.owner_login, avatarUrl: row.owner_avatar },
    downloads: row.downloads,
    updatedAt: row.updated_at,
    source: sourceUrl(origin, row.name, row.latest),
    counts: { templates: row.templates, rules: row.rules, assets: row.assets, recipes: row.recipes },
  };
}

/** `%`, `_` and `\` are LIKE syntax; a search for them means the characters. */
const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;

export async function listPacks(
  db: D1Database,
  origin: string,
  opts: { q?: string; limit?: number; ownerId?: number } = {},
): Promise<PackListing[]> {
  const where: string[] = [];
  const binds: unknown[] = [];
  const q = opts.q?.trim();
  if (q) {
    where.push("(p.name LIKE ?1 ESCAPE '\\' OR p.title LIKE ?1 ESCAPE '\\' OR p.description LIKE ?1 ESCAPE '\\')");
    binds.push(likePattern(q));
  }
  if (opts.ownerId != null) {
    where.push(`p.owner_id = ?${binds.length + 1}`);
    binds.push(opts.ownerId);
  }
  const limit = Math.min(Math.max(Math.trunc(opts.limit ?? 50) || 50, 1), 100);
  const sql = `${PACK_SELECT} ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY p.downloads DESC, p.updated_at DESC LIMIT ${limit}`;
  const { results } = await db.prepare(sql).bind(...binds).all<PackRow>();
  return results.map((row) => toListing(row, origin));
}

export async function getPack(db: D1Database, origin: string, name: string): Promise<PackDetail | null> {
  const row = await db.prepare(`${PACK_SELECT} WHERE p.name = ?`).bind(name).first<PackRow>();
  if (!row) return null;
  const { results } = await db
    .prepare("SELECT version, published_at, size, manifest FROM pack_versions WHERE name = ?")
    .bind(name)
    .all<{ version: string; published_at: number; size: number; manifest: string }>();
  const versions = results.sort((a, b) => compareVersions(b.version, a.version));
  const latest = versions.find((v) => v.version === row.latest) ?? versions[0];
  const manifest = PackManifest.parse(JSON.parse(latest.manifest));
  return {
    ...toListing(row, origin),
    versions: versions.map((v) => ({ version: v.version, publishedAt: v.published_at, size: v.size })),
    manifest,
  };
}

/** `latest` resolves to the pack's latest version; anything else is taken as given. */
export async function resolveVersion(db: D1Database, name: string, version: string): Promise<string | null> {
  if (version !== "latest") return version;
  const row = await db.prepare("SELECT latest FROM packs WHERE name = ?").bind(name).first<{ latest: string }>();
  return row?.latest ?? null;
}

export const objectKey = (name: string, version: string, path: string) => `packs/${name}/${version}/${path}`;

/** Relative, forward slashes, no `.` or `..` segments, nothing hidden in control characters. */
export function pathProblem(path: string): string | null {
  if (typeof path !== "string" || !path) return "empty path";
  if (path.length > 512) return `path too long: ${path.slice(0, 40)}…`;
  if (path.includes("\\")) return `backslash in path: ${path}`;
  if (path.startsWith("/") || /^[A-Za-z]:/.test(path)) return `absolute path: ${path}`;
  if (/[\u0000-\u001f\u007f]/.test(path)) return `control character in path: ${JSON.stringify(path)}`;
  const segments = path.split("/");
  if (segments.some((s) => s === "..")) return `path leaves the pack: ${path}`;
  if (segments.some((s) => s === "" || s === ".")) return `malformed path: ${path}`;
  return null;
}

export type PublishFile = { path: string; bytes: Uint8Array };

export type PublishError = { status: 400 | 401 | 403 | 409 | 413; body: { error: string; issues?: unknown } };

export type ParsedUpload = { manifest: PackManifest; manifestText: string; files: PublishFile[]; size: number };

/** Everything the upload must hold that does not need the database. */
export function parseUpload(body: unknown): ParsedUpload | PublishError {
  const bad = (error: string, issues?: unknown): PublishError => ({ status: 400, body: issues ? { error, issues } : { error } });
  if (!body || typeof body !== "object" || !Array.isArray((body as { files?: unknown }).files)) {
    return bad("body must be { files: Array<{ path, base64 }> }");
  }
  const raw = (body as { files: unknown[] }).files;
  if (raw.length === 0) return bad("no files");
  if (raw.length > MAX_FILES) return { status: 413, body: { error: `too many files: ${raw.length} (at most ${MAX_FILES})` } };

  const files: PublishFile[] = [];
  const seen = new Set<string>();
  let size = 0;
  for (const entry of raw) {
    const { path, base64 } = (entry ?? {}) as { path?: unknown; base64?: unknown };
    if (typeof path !== "string" || typeof base64 !== "string") return bad("each file needs a string path and base64");
    const problem = pathProblem(path);
    if (problem) return bad(problem);
    if (seen.has(path)) return bad(`duplicate file: ${path}`);
    seen.add(path);
    const bytes = decodeBase64(base64);
    if (!bytes) return bad(`not valid base64: ${path}`);
    size += bytes.byteLength;
    if (size > MAX_TOTAL_BYTES) return { status: 413, body: { error: "pack is larger than 50 MB" } };
    files.push({ path, bytes });
  }

  const manifestFile = files.find((f) => f.path === "pack.json");
  if (!manifestFile) return bad("pack.json is missing");
  const manifestText = new TextDecoder().decode(manifestFile.bytes);
  let json: unknown;
  try {
    json = JSON.parse(manifestText);
  } catch {
    return bad("pack.json is not valid JSON");
  }
  const parsed = PackManifest.safeParse(json);
  if (!parsed.success) return bad("pack.json does not match the pack schema", parsed.error.issues);
  const manifest = parsed.data;
  if (!VERSION_RE.test(manifest.version)) return bad(`version must look like 1.2.3: ${manifest.version}`);

  const missing = referencedFiles(manifest, files).filter((p) => !seen.has(p));
  if (missing.length) return bad(`files named in pack.json are missing: ${missing.join(", ")}`, { missing });
  return { manifest, manifestText, files, size };
}

/** Every path the manifest (and its rules' prompt files) points at. */
export function referencedFiles(manifest: PackManifest, files: PublishFile[]): string[] {
  const refs = new Set<string>();
  for (const id of manifest.templates) refs.add(`templates/${id}.json`);
  for (const id of manifest.rules) {
    const path = `rules/${id}.json`;
    refs.add(path);
    const file = files.find((f) => f.path === path);
    if (!file) continue;
    try {
      const rule = JSON.parse(new TextDecoder().decode(file.bytes)) as { then?: { promptFile?: unknown } };
      if (typeof rule.then?.promptFile === "string" && rule.then.promptFile) refs.add(`rules/${rule.then.promptFile}`);
    } catch {
      // An unreadable rule is the app's to refuse at import; it is present, which is what this checks.
    }
  }
  for (const a of manifest.assets) refs.add(a.file);
  for (const e of manifest.examples) refs.add(e.file);
  for (const r of manifest.recipes) refs.add(r.file);
  for (const f of manifest.recipeFiles) refs.add(f);
  if (manifest.style) refs.add(manifest.style);
  if (manifest.review) refs.add(manifest.review);
  return [...refs];
}

export function countsOf(manifest: PackManifest): PackCounts {
  return {
    templates: manifest.templates.length,
    rules: manifest.rules.length,
    assets: manifest.assets.length,
    recipes: manifest.recipes.length,
  };
}

export async function publish(
  env: { DB: D1Database; PACKS: R2Bucket },
  user: User,
  upload: ParsedUpload,
): Promise<{ name: string; version: string } | PublishError> {
  const { manifest } = upload;
  const name = manifest.id;
  const version = manifest.version;
  const db = env.DB;

  const pack = await db.prepare("SELECT owner_id FROM packs WHERE name = ?").bind(name).first<{ owner_id: number }>();
  if (pack && pack.owner_id !== user.id) return { status: 403, body: { error: `${name} belongs to another publisher` } };
  const exists = await db.prepare("SELECT 1 FROM pack_versions WHERE name = ? AND version = ?").bind(name, version).first();
  if (exists) return { status: 409, body: { error: "version exists" } };

  for (const file of upload.files) {
    await env.PACKS.put(objectKey(name, version, file.path), file.bytes);
  }

  const now = Date.now();
  const counts = countsOf(manifest);
  const stmts: D1PreparedStatement[] = [];
  if (!pack) {
    stmts.push(
      db.prepare(
        `INSERT INTO packs (name, owner_id, title, description, author, latest, templates, rules, assets, recipes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(name) DO NOTHING`,
      ).bind(name, user.id, manifest.name, manifest.description, manifest.author, version,
        counts.templates, counts.rules, counts.assets, counts.recipes, now, now),
    );
  }
  stmts.push(
    db.prepare(
      `INSERT INTO pack_versions (name, version, manifest, size, file_count, published_by, published_at)
       SELECT ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM packs WHERE name = ? AND owner_id = ?)`,
    ).bind(name, version, JSON.stringify(manifest), upload.size, upload.files.length, user.id, now, name, user.id),
  );
  try {
    const results = await db.batch(stmts);
    if (!results[results.length - 1].meta.changes) return { status: 403, body: { error: `${name} belongs to another publisher` } };
  } catch (err) {
    if (String(err).includes("UNIQUE")) return { status: 409, body: { error: "version exists" } };
    throw err;
  }

  // The latest is the highest version, not the newest upload: a 1.0.1 patch after 2.0.0 stays behind it.
  const { results } = await db.prepare("SELECT version, manifest FROM pack_versions WHERE name = ?").bind(name).all<{ version: string; manifest: string }>();
  const latest = highest(results.map((r) => r.version));
  const latestManifest = PackManifest.parse(JSON.parse(results.find((r) => r.version === latest)!.manifest));
  const lc = countsOf(latestManifest);
  await db
    .prepare(
      `UPDATE packs SET latest = ?, title = ?, description = ?, author = ?, templates = ?, rules = ?, assets = ?, recipes = ?, updated_at = ?
       WHERE name = ?`,
    )
    .bind(latest, latestManifest.name, latestManifest.description, latestManifest.author, lc.templates, lc.rules, lc.assets, lc.recipes, now, name)
    .run();
  return { name, version };
}
