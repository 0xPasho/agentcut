/**
 * Where this AgentCut lives and keeps its downloads, decided without reading the
 * workspace. Kept apart from config.ts because ffmpeg's location depends on it, and
 * importing that must not fix WORKSPACE before a test or a caller has set
 * AGENTCUT_WORKSPACE.
 */
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";

/** The monorepo's root package.json carries this name; the published CLI carries `agentcut`. */
const CHECKOUT_NAME = "agentcut-monorepo";
const INSTALL_NAME = "agentcut";

function packageName(dir: string): string | undefined {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"))?.name;
  } catch {
    // Not a package dir, or a package.json we cannot read.
    return undefined;
  }
}

/**
 * Walk up from `start` to the first directory that is either a source checkout or an
 * installed `agentcut` package. Bundled code reports a path inside `.next/` or `dist/`,
 * which still sits under one of the two, so the same walk serves the dev server, a
 * production build, tsx and the published CLI.
 */
function findRoot(start: string | undefined) {
  if (!start) return undefined;
  let dir = path.resolve(start);
  for (;;) {
    const name = packageName(dir);
    if (name === CHECKOUT_NAME || name === INSTALL_NAME) return dir;
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
 * The checkout or the installed CLI this process belongs to, independent of
 * process.cwd(): a script launched by absolute path from any directory resolves the
 * same workspace as the studio does. `AGENTCUT_ROOT` is how the CLI hands its own
 * location to the studio server, which runs from a downloaded copy elsewhere.
 */
export const ROOT =
  (process.env.AGENTCUT_ROOT && path.resolve(process.env.AGENTCUT_ROOT)) ||
  findRoot(moduleDir()) ||
  findRoot(process.cwd()) ||
  process.cwd();

/** A source checkout runs from TypeScript and keeps its workspace beside the code. */
export const IS_CHECKOUT = packageName(ROOT) !== INSTALL_NAME;

/** Everything an installed AgentCut keeps on this machine: the workspace and the downloaded runtime. */
export const HOME = process.env.AGENTCUT_HOME ? path.resolve(process.env.AGENTCUT_HOME) : path.join(os.homedir(), ".agentcut");

/** Components downloaded on first use: ffmpeg, the renderer and the studio. */
export const RUNTIME = process.env.AGENTCUT_RUNTIME ? path.resolve(process.env.AGENTCUT_RUNTIME) : path.join(HOME, "runtime");

/** Files core reads at run time: sound effects and the phone helper's source. */
export const ASSETS = IS_CHECKOUT ? path.join(ROOT, "packages", "core", "assets") : path.join(ROOT, "assets");
