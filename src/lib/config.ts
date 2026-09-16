import path from "node:path";
import fs from "node:fs";

export const ROOT = process.cwd();
export const WORKSPACE = process.env.AGENTCUT_WORKSPACE
  ? path.resolve(process.env.AGENTCUT_WORKSPACE)
  : path.join(ROOT, "workspace");

/**
 * Prefer the new filename, but keep reading an existing clipsmith.db rather than
 * silently starting an empty database on top of a rename.
 */
export const DB_PATH = fs.existsSync(path.join(WORKSPACE, "agentcut.db"))
  ? path.join(WORKSPACE, "agentcut.db")
  : fs.existsSync(path.join(WORKSPACE, "clipsmith.db"))
    ? path.join(WORKSPACE, "clipsmith.db")
    : path.join(WORKSPACE, "agentcut.db");

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
