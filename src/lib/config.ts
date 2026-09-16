import path from "node:path";
import fs from "node:fs";

export const ROOT = process.cwd();
export const WORKSPACE = process.env.AGENTCUT_WORKSPACE
  ? path.resolve(process.env.AGENTCUT_WORKSPACE)
  : path.join(ROOT, "workspace");

/**
 * A pre-rename database wins if it is present. Checking "does the new file exist"
 * is not enough: any process that starts before the old one is migrated creates an
 * empty agentcut.db, and every later process then prefers that empty file.
 */
const LEGACY_DB = path.join(WORKSPACE, "clipsmith.db");
export const DB_PATH = fs.existsSync(LEGACY_DB) ? LEGACY_DB : path.join(WORKSPACE, "agentcut.db");

/** Per-project scratch dir. All agent filesystem access is confined here. */
export function projectDir(id: string) {
  const dir = path.join(WORKSPACE, "projects", id);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function ensureWorkspace() {
  fs.mkdirSync(path.join(WORKSPACE, "projects"), { recursive: true });
  return WORKSPACE;
}
