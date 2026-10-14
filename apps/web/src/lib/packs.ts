/**
 * The registry. A pack is a public GitHub repository, or a folder in one, pinned to a
 * commit: the rows here are metadata and the manifest as it read at that commit, never
 * the pack's bytes. `source` is a raw.githubusercontent URL, which is what `packs.import`
 * installs from.
 */
import { PackManifest } from "@agentcut/core/modules/packs/types";
import { PACK_IMAGE_MAX_BYTES } from "@agentcut/core/modules/packs/data";
import { packImageFiles } from "@agentcut/core/modules/packs/lib/images";
import type { User } from "../env";
import { isUniqueViolation, type Sql } from "./db";
import { GitHub, GitHubError, parseRepoInput } from "./github";
import { VERSION_RE, compareVersions, highest } from "./semver";

export type PackCounts = { templates: number; rules: number; assets: number; recipes: number };

export type PackRepo = { owner: string; name: string; folder: string; branch: string; url: string };

export type PackListing = {
  name: string;
  title: string;
  description: string;
  latest: string;
  author: string;
  owner: { login: string; avatarUrl: string | null };
  stars: number;
  updatedAt: number;
  source: string;
  /** The latest version's cover as a URL at its commit, or "" when it has none. */
  cover: string;
  repo: PackRepo;
  counts: PackCounts;
};

export type PackVersion = { version: string; publishedAt: number; size: number; sha: string; source: string };

export type PackDetail = PackListing & { versions: PackVersion[]; manifest: PackManifest };

type PackRow = {
  name: string;
  title: string;
  description: string;
  author: string;
  latest: string;
  latest_sha: string;
  cover: string;
  repo_owner: string;
  repo_name: string;
  folder: string;
  branch: string;
  stars: number;
  updated_at: number;
  templates: number;
  rules: number;
  assets: number;
  recipes: number;
  owner_login: string;
  owner_avatar: string | null;
};

const packSelect = (sql: Sql) => sql`SELECT p.name, p.title, p.description, p.author, p.latest, p.latest_sha, p.cover, p.repo_owner,
  p.repo_name, p.folder, p.branch, p.stars, p.updated_at, p.templates, p.rules, p.assets, p.recipes,
  u.login AS owner_login, u.avatar_url AS owner_avatar
  FROM packs p JOIN users u ON u.id = p.owner_id`;

/** Where a version's files are read from: the repository at that commit, in its folder. */
export function sourceUrl(gh: GitHub, repo: { owner: string; name: string; folder: string }, sha: string): string {
  return gh.rawUrl(repo.owner, repo.name, sha, repo.folder);
}

/** A file of a version, from the version's source URL: the repository at that commit. */
export const fileUrl = (source: string, path: string) => `${source}/${path.split("/").map(encodeURIComponent).join("/")}`;

export const repoUrl = (repo: PackRepo) =>
  `https://github.com/${repo.owner}/${repo.name}${repo.folder ? `/tree/${repo.branch}/${repo.folder}` : ""}`;

function toListing(row: PackRow, gh: GitHub): PackListing {
  const repo: PackRepo = {
    owner: row.repo_owner,
    name: row.repo_name,
    folder: row.folder,
    branch: row.branch,
    url: "",
  };
  repo.url = repoUrl(repo);
  const source = sourceUrl(gh, repo, row.latest_sha);
  return {
    name: row.name,
    title: row.title,
    description: row.description,
    latest: row.latest,
    author: row.author,
    owner: { login: row.owner_login, avatarUrl: row.owner_avatar },
    stars: row.stars,
    updatedAt: row.updated_at,
    source,
    cover: row.cover ? fileUrl(source, row.cover) : "",
    repo,
    counts: { templates: row.templates, rules: row.rules, assets: row.assets, recipes: row.recipes },
  };
}

/** `%`, `_` and `\` are LIKE syntax; a search for them means the characters. */
const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;

export async function listPacks(
  sql: Sql,
  gh: GitHub,
  opts: { q?: string; limit?: number; ownerId?: number } = {},
): Promise<PackListing[]> {
  const q = opts.q?.trim();
  const pattern = q ? likePattern(q) : "";
  const limit = Math.min(Math.max(Math.trunc(opts.limit ?? 50) || 50, 1), 100);
  const rows = await sql<PackRow[]>`${packSelect(sql)}
    WHERE TRUE
    ${q ? sql`AND (p.name ILIKE ${pattern} OR p.title ILIKE ${pattern} OR p.description ILIKE ${pattern})` : sql``}
    ${opts.ownerId != null ? sql`AND p.owner_id = ${opts.ownerId}` : sql``}
    ORDER BY p.stars DESC, p.updated_at DESC LIMIT ${limit}`;
  return rows.map((row) => toListing(row, gh));
}

export async function getPack(sql: Sql, gh: GitHub, name: string): Promise<PackDetail | null> {
  const [row] = await sql<PackRow[]>`${packSelect(sql)} WHERE p.name = ${name}`;
  if (!row) return null;
  const versions = await sql<{ version: string; published_at: number; size: number; sha: string; manifest: string }[]>`
    SELECT version, published_at, size, sha, manifest FROM pack_versions WHERE name = ${name}`;
  const sorted = [...versions].sort((a, b) => compareVersions(b.version, a.version));
  const latest = sorted.find((v) => v.version === row.latest) ?? sorted[0];
  const listing = toListing(row, gh);
  return {
    ...listing,
    versions: sorted.map((v) => ({
      version: v.version,
      publishedAt: v.published_at,
      size: v.size,
      sha: v.sha,
      source: sourceUrl(gh, listing.repo, v.sha),
    })),
    manifest: PackManifest.parse(JSON.parse(latest.manifest)),
  };
}

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

/**
 * Every path the manifest points at, including a rule's prompt file, which is named
 * inside the rule rather than in the manifest, so the rules are read to find it.
 */
export async function referencedFiles(
  manifest: PackManifest,
  read: (path: string) => Promise<string | null>,
): Promise<string[]> {
  const refs = new Set<string>();
  for (const id of manifest.templates) refs.add(`templates/${id}.json`);
  for (const id of manifest.rules) {
    const path = `rules/${id}.json`;
    refs.add(path);
    const text = await read(path);
    if (!text) continue;
    try {
      const rule = JSON.parse(text) as { then?: { promptFile?: unknown } };
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
  for (const f of packImageFiles(manifest)) refs.add(f);
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

export type PackError = { status: 400 | 403 | 404 | 409 | 429 | 502; body: { error: string; issues?: unknown } };

export type RegisterInput = { repo: string; folder?: string };

export type Registered = { name: string; version: string; sha: string; updated: boolean };

/** What a commit holds, once we have agreed it is a pack. */
type ReadPack = { manifest: PackManifest; manifestText: string; size: number; sha: string };

const bad = (error: string, issues?: unknown): PackError => ({ status: 400, body: issues ? { error, issues } : { error } });

/**
 * Register a repository as a pack, or add the version it is on now. The person must own
 * the repository on GitHub: a pack is theirs to update, and the owner is who we ask.
 */
export async function registerPack(
  sql: Sql,
  gh: GitHub,
  user: User,
  input: RegisterInput,
): Promise<Registered | PackError> {
  if (!user.login) return { status: 403, body: { error: "Connect your GitHub account before submitting a pack." } };
  const ref = parseRepoInput(input.repo, input.folder ?? "");
  if ("error" in ref) return bad(ref.error);

  try {
    const repo = await gh.repo(ref.owner, ref.repo);
    if (repo.private) return bad("That repository is private. A pack has to be public for anybody to install it.");
    if (repo.owner.toLowerCase() !== user.login.toLowerCase()) {
      return { status: 403, body: { error: `${repo.owner}/${repo.repo} is not yours. You can only submit repositories your GitHub account owns.` } };
    }
    const branch = ref.ref ?? repo.defaultBranch;
    const read = await readPack(gh, repo.owner, repo.repo, branch, ref.folder);
    if ("status" in read) return read;
    return await save(sql, gh, user, { owner: repo.owner, name: repo.repo, folder: ref.folder, branch, url: "" }, repo.stars, read);
  } catch (error) {
    if (error instanceof GitHubError) return { status: error.status === 404 ? 404 : error.status === 429 ? 429 : 502, body: { error: error.message } };
    throw error;
  }
}

/**
 * Read the repository again and register whatever version it is on now. This is the
 * Check for updates button: a pack follows its branch, and a bumped `version` in
 * pack.json becomes a new version here.
 */
export async function refreshPack(
  sql: Sql,
  gh: GitHub,
  user: User,
  name: string,
): Promise<Registered | PackError> {
  const [row] = await sql<{ repo_owner: string; repo_name: string; folder: string; branch: string; owner_id: number }[]>`
    SELECT repo_owner, repo_name, folder, branch, owner_id FROM packs WHERE name = ${name}`;
  if (!row) return { status: 404, body: { error: "pack not found" } };
  if (row.owner_id !== user.id) return { status: 403, body: { error: `${name} belongs to somebody else.` } };
  try {
    const repo = await gh.repo(row.repo_owner, row.repo_name);
    const read = await readPack(gh, row.repo_owner, row.repo_name, row.branch, row.folder);
    if ("status" in read) return read;
    return await save(sql, gh, user, { owner: row.repo_owner, name: row.repo_name, folder: row.folder, branch: row.branch, url: "" }, repo.stars, read);
  } catch (error) {
    if (error instanceof GitHubError) return { status: error.status === 404 ? 404 : error.status === 429 ? 429 : 502, body: { error: error.message } };
    throw error;
  }
}

/** A pack its owner takes down. The versions go with it; the name stays theirs to reuse. */
export async function removePack(sql: Sql, user: User, name: string): Promise<true | PackError> {
  const [row] = await sql<{ owner_id: number }[]>`SELECT owner_id FROM packs WHERE name = ${name}`;
  if (!row) return { status: 404, body: { error: "pack not found" } };
  if (row.owner_id !== user.id) return { status: 403, body: { error: `${name} belongs to somebody else.` } };
  // The versions go with the pack (ON DELETE CASCADE).
  await sql`DELETE FROM packs WHERE name = ${name} AND owner_id = ${user.id}`;
  return true;
}

/** pack.json at the head of a branch, with every file it names checked to be there. */
async function readPack(
  gh: GitHub,
  owner: string,
  repo: string,
  branch: string,
  folder: string,
): Promise<ReadPack | PackError> {
  const sha = await gh.commit(owner, repo, branch);
  const at = (path: string) => (folder ? `${folder}/${path}` : path);
  const manifestText = await gh.file(owner, repo, sha, at("pack.json"));
  if (manifestText === null) {
    return bad(`No pack.json in ${owner}/${repo}${folder ? `/${folder}` : ""} at ${branch}. Point at the folder that holds it.`);
  }
  let json: unknown;
  try {
    json = JSON.parse(manifestText);
  } catch {
    return bad("pack.json is not valid JSON.");
  }
  const parsed = PackManifest.safeParse(json);
  if (!parsed.success) return bad("pack.json does not match the pack schema.", parsed.error.issues);
  const manifest = parsed.data;
  if (!VERSION_RE.test(manifest.version)) return bad(`version must look like 1.2.3: ${manifest.version}`);

  const read = (path: string) => gh.file(owner, repo, sha, at(path));
  const refs = await referencedFiles(manifest, read);
  const problem = refs.map((path) => pathProblem(path)).find(Boolean);
  if (problem) return bad(problem);

  const tree = await gh.tree(owner, repo, sha);
  let size = tree.files.get(at("pack.json")) ?? 0;
  const missing: string[] = [];
  for (const path of refs) {
    const full = at(path);
    if (tree.truncated) {
      if (!(await gh.exists(owner, repo, sha, full))) missing.push(path);
      continue;
    }
    const bytes = tree.files.get(full);
    if (bytes === undefined) missing.push(path);
    else size += bytes;
  }
  if (missing.length) return bad(`files named in pack.json are not in the repository: ${missing.join(", ")}`, { missing });
  // A picture is on every card and every pack page, so it has a weight limit of its own.
  const heavy = packImageFiles(manifest).filter((path) => (tree.files.get(at(path)) ?? 0) > PACK_IMAGE_MAX_BYTES);
  if (heavy.length) return bad(`pictures over ${PACK_IMAGE_MAX_BYTES / 1024 / 1024} MB: ${heavy.join(", ")}`, { heavy });
  return { manifest, manifestText, size, sha };
}

async function save(
  sql: Sql,
  gh: GitHub,
  user: User,
  repo: PackRepo,
  stars: number,
  read: ReadPack,
): Promise<Registered | PackError> {
  const { manifest, sha } = read;
  const name = manifest.id;
  const version = manifest.version;

  const [existing] = await sql<{ owner_id: number; repo_owner: string; repo_name: string; folder: string }[]>`
    SELECT owner_id, repo_owner, repo_name, folder FROM packs WHERE name = ${name}`;
  if (existing && existing.owner_id !== user.id) return { status: 403, body: { error: `${name} belongs to another publisher` } };
  const [claimed] = await sql<{ name: string }[]>`
    SELECT name FROM packs WHERE repo_owner = ${repo.owner} AND repo_name = ${repo.name} AND folder = ${repo.folder} AND name <> ${name}`;
  if (claimed) return { status: 409, body: { error: `That folder is already registered as ${claimed.name}.` } };

  const [pinned] = await sql<{ sha: string }[]>`SELECT sha FROM pack_versions WHERE name = ${name} AND version = ${version}`;
  if (pinned) {
    if (pinned.sha === sha) return { name, version, sha, updated: false };
    return {
      status: 409,
      body: { error: `${name} ${version} is already registered at another commit. Bump version in pack.json and try again.` },
    };
  }

  const now = Date.now();
  const counts = countsOf(manifest);
  try {
    // The version, and the pack row that points at the highest one, land together or not at all.
    const added = await sql.begin(async (tx) => {
      if (!existing) {
        await tx`
          INSERT INTO packs (name, owner_id, repo_owner, repo_name, folder, branch, title, description, author,
            latest, latest_sha, cover, stars, templates, rules, assets, recipes, created_at, updated_at)
          VALUES (${name}, ${user.id}, ${repo.owner}, ${repo.name}, ${repo.folder}, ${repo.branch}, ${manifest.name},
            ${manifest.description}, ${manifest.author}, ${version}, ${sha}, ${manifest.cover}, ${stars}, ${counts.templates}, ${counts.rules},
            ${counts.assets}, ${counts.recipes}, ${now}, ${now})
          ON CONFLICT (name) DO NOTHING`;
      }
      // Only into a pack this person owns: a name claimed between our check and now is not theirs.
      const inserted = await tx`
        INSERT INTO pack_versions (name, version, sha, manifest, size, published_at)
        SELECT ${name}, ${version}, ${sha}, ${JSON.stringify(manifest)}, ${read.size}, ${now}
        WHERE EXISTS (SELECT 1 FROM packs WHERE name = ${name} AND owner_id = ${user.id})`;
      if (!inserted.count) return false;

      // The latest is the highest version, not the newest submission: a 1.0.1 after 2.0.0 stays behind it.
      const versions = await tx<{ version: string; sha: string; manifest: string }[]>`
        SELECT version, sha, manifest FROM pack_versions WHERE name = ${name}`;
      const latest = highest(versions.map((r) => r.version));
      const row = versions.find((r) => r.version === latest)!;
      const latestManifest = PackManifest.parse(JSON.parse(row.manifest));
      const lc = countsOf(latestManifest);
      await tx`
        UPDATE packs SET latest = ${latest}, latest_sha = ${row.sha}, cover = ${latestManifest.cover}, title = ${latestManifest.name},
          description = ${latestManifest.description}, author = ${latestManifest.author}, repo_owner = ${repo.owner},
          repo_name = ${repo.name}, folder = ${repo.folder}, branch = ${repo.branch}, stars = ${stars},
          templates = ${lc.templates}, rules = ${lc.rules}, assets = ${lc.assets}, recipes = ${lc.recipes}, updated_at = ${now}
        WHERE name = ${name}`;
      return true;
    });
    if (!added) return { status: 403, body: { error: `${name} belongs to another publisher` } };
  } catch (err) {
    if (isUniqueViolation(err)) return { status: 409, body: { error: "version exists" } };
    throw err;
  }
  return { name, version, sha, updated: Boolean(existing) };
}
