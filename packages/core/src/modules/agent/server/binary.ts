import { accessSync, constants, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { harness, type Harness } from "../lib/registry";

/**
 * Resolve a CLI's name to the file it actually is, once, and spawn THAT.
 *
 * `which()` in lib/bin.ts shells out to /usr/bin/which, which searches the PATH
 * this process happens to hold. That is the terminal's PATH when `next dev` was
 * started from a terminal, and something much shorter when it was not — a
 * launchd-started server, a packaged build, a job spawned by another job. An
 * agent CLI installed under ~/.local/bin or a versioned nvm directory is then
 * invisible, and the failure reads as "no agent CLI found" on a machine with
 * four of them.
 *
 * So: search the real PATH, then a padded list of the places these CLIs
 * actually install to, and hand back the absolute path. A name resolved here
 * cannot then be resolved differently by the spawn that follows it.
 */

/** Windows resolves a bare name through PATHEXT; everywhere else the file is the name. */
const WINDOWS_SUFFIXES = [".cmd", ".exe", ".bat", ""];

function candidateNames(base: string): string[] {
  if (process.platform !== "win32") return [base];
  return WINDOWS_SUFFIXES.map((suffix) => `${base}${suffix}`);
}

function isExecutableFile(candidate: string): boolean {
  try {
    accessSync(candidate, process.platform === "win32" ? constants.F_OK : constants.X_OK);
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
}

/**
 * Where these CLIs land when PATH does not say. Ordered by how these four are
 * actually distributed: their own installers write to ~/.local/bin, Homebrew is
 * next, then the npm/bun/pnpm global bins.
 */
function paddedDirs(): string[] {
  const home = os.homedir();
  return [
    path.join(home, ".local", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    path.join(home, ".bun", "bin"),
    path.join(home, ".npm-global", "bin"),
    path.join(home, ".volta", "bin"),
    path.join(home, ".cargo", "bin"),
    "/usr/bin",
  ];
}

/** Every directory to search, PATH first so a user's own ordering still wins. */
export function searchDirs(pathEnv = process.env.PATH): string[] {
  const fromPath = (pathEnv ?? "").split(path.delimiter).filter(Boolean);
  const seen = new Set(fromPath);
  return [...fromPath, ...paddedDirs().filter((dir) => !seen.has(dir))];
}

/**
 * The absolute path `name` resolves to, or null.
 *
 * A name that is already a path comes back untouched: somebody configured it,
 * and second-guessing a configured path would be a different bug.
 */
export function resolveBinary(name: string, pathEnv = process.env.PATH): string | null {
  if (!name) return null;
  if (path.isAbsolute(name) || name.includes("/") || name.includes("\\")) {
    return isExecutableFile(name) ? name : null;
  }
  for (const dir of searchDirs(pathEnv)) {
    for (const candidate of candidateNames(name)) {
      const full = path.join(dir, candidate);
      if (isExecutableFile(full)) return full;
    }
  }
  return null;
}

/**
 * The binary for a harness, honouring its override env var.
 *
 * Deliberately uncached: a cache here would outlive the user installing the CLI
 * they were just told they lack, and the lookup is a handful of stat calls.
 */
export function harnessBinary(h: Harness | string): string | null {
  const entry = typeof h === "string" ? harness(h) : h;
  if (!entry) return null;
  const override = process.env[entry.binEnv];
  if (override) return resolveBinary(override);
  return resolveBinary(entry.bin);
}

/**
 * What to spawn for `name`: the resolved path when there is one, else the name
 * itself so the OS's own lookup still gets its chance — and its ENOENT is still
 * the honest answer when there is nothing to find.
 */
export function spawnable(h: Harness | string): string {
  const entry = typeof h === "string" ? harness(h) : h;
  if (!entry) throw new Error(`unknown harness: ${String(h)}`);
  return harnessBinary(entry) ?? entry.bin;
}
