import path from "node:path";
import fs from "node:fs";

export const ROOT = process.cwd();
export const WORKSPACE = process.env.CLIPSMITH_WORKSPACE
  ? path.resolve(process.env.CLIPSMITH_WORKSPACE)
  : path.join(ROOT, "workspace");

export const DB_PATH = path.join(WORKSPACE, "clipsmith.db");

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
