import path from "node:path";
import fs from "node:fs";
import { HOME, IS_CHECKOUT, ROOT } from "./root";

export { ASSETS, HOME, IS_CHECKOUT, ROOT, RUNTIME } from "./root";

export const WORKSPACE = process.env.AGENTCUT_WORKSPACE
  ? path.resolve(process.env.AGENTCUT_WORKSPACE)
  : IS_CHECKOUT ? path.join(ROOT, "workspace") : path.join(HOME, "workspace");

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

/**
 * How to start one of the CLI's commands as a child process: from TypeScript through
 * tsx in a checkout, from the bundled `dist/commands` when installed. Long-running
 * workers (publishing) are spawned through here so both installs start the same code.
 */
export function cliCommand(name: string): { command: string; args: string[] } {
  if (IS_CHECKOUT) {
    const loader = path.join(ROOT, "node_modules", "tsx", "dist", "loader.mjs");
    return { command: process.execPath, args: ["--import", loader, path.join(ROOT, "packages", "cli", "src", "commands", `${name}.ts`)] };
  }
  return { command: process.execPath, args: [path.join(ROOT, "dist", "commands", `${name}.mjs`)] };
}
