import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const PACKAGE_NAME = "agentcut";

/**
 * Walk up from `start` until a package.json belonging to this app shows up.
 * Bundled code reports a path inside `.next/`, which still sits under the app
 * root, so the same walk works for the dev server, a production build and tsx.
 */
function findPackageRoot(start: string | undefined) {
  if (!start) return undefined;
  let dir = path.resolve(start);
  for (;;) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
      if (pkg?.name === PACKAGE_NAME) return dir;
    } catch {
      // Not a package dir, or a package.json we cannot read: keep climbing.
    }
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/**
 * Directory of this module. `import.meta.url` is rewritten by the Next bundler
 * and by tsx's CJS loader; `__dirname` covers a plain CommonJS require. Either
 * may be missing or synthetic, so both are treated as hints, not answers.
 */
function moduleDir() {
  try {
    const url = import.meta?.url;
    if (url?.startsWith("file:")) return path.dirname(fileURLToPath(url));
  } catch {
    // import.meta is unavailable in this runtime.
  }
  return typeof __dirname === "string" ? __dirname : undefined;
}

/**
 * App root, independent of process.cwd(): a script launched by absolute path
 * from any directory resolves the same workspace as `next dev` does.
 */
export const ROOT =
  (process.env.AGENTCUT_ROOT && path.resolve(process.env.AGENTCUT_ROOT)) ||
  findPackageRoot(moduleDir()) ||
  findPackageRoot(process.cwd()) ||
  process.cwd();

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
