import fs from "node:fs/promises";
import { constants, createWriteStream } from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { kindFor } from "./assets";
import { localPath, places } from "./local-assets";
import type { FileFingerprint, ResolvedLocalFile } from "../types";

/**
 * How a file on this machine gets into the workspace. Three facts decide it:
 *
 * 1. The server and the file share a disk, so copying is waste. On APFS a clone is a
 *    copy that costs nothing: instant, and no second set of blocks until one side is
 *    written. `cloneFile` clones where the filesystem can and copies for real where it
 *    cannot (another volume, another OS), which is decision 137's fallback.
 * 2. A browser drop or file input hands over bytes and hides the path. But it does
 *    hand over the name, the size and the modification time, and Spotlight can turn
 *    those back into a path in milliseconds. So a drop is resolved to its path first
 *    and cloned; only a file Spotlight does not know is streamed in.
 * 3. A stream recording is five to seven gigabytes. Anything that holds the whole
 *    file in memory dies at two, so the bytes path is a pipeline to disk, never a buffer.
 */

/**
 * A clone where the filesystem supports one, a real copy where it does not.
 *
 * Node's `COPYFILE_FICLONE` only clones on Linux; on macOS it quietly copies, and the
 * forced flag fails with ENOSYS. So on a Mac the clone is `cp -c`, which is
 * `clonefile(2)`: a seven-gigabyte recording in a few milliseconds, sharing its blocks
 * with the original until either is written. Anything that refuses (another volume, a
 * filesystem without clones) gets the plain copy.
 */
export async function cloneFile(source: string, target: string) {
  if (process.platform === "darwin" && await cloneWithCp(source, target)) return;
  await fs.copyFile(source, target, constants.COPYFILE_FICLONE);
}

function cloneWithCp(source: string, target: string): Promise<boolean> {
  return new Promise(resolve => {
    execFile("/bin/cp", ["-c", "--", source, target], { timeout: 60_000 }, async error => {
      if (!error) return resolve(true);
      // A failed attempt may leave a partial target; the copy that follows starts clean.
      await fs.rm(target, { force: true }).catch(() => undefined);
      resolve(false);
    });
  });
}

/** The request body straight to disk, as it arrives. */
export async function saveStream(body: ReadableStream | NodeJS.ReadableStream, target: string) {
  const readable = body instanceof Readable ? body : Readable.fromWeb(body as Parameters<typeof Readable.fromWeb>[0]);
  await pipeline(readable, createWriteStream(target));
}

/** What a browser's `File` says about itself: enough to find it on disk. */
export function fingerprintOf(input: { name?: string | null; size?: number | string | null; modifiedAt?: number | string | null }): FileFingerprint | null {
  const name = path.basename(String(input.name ?? "").trim());
  const size = Number(input.size);
  const modifiedAt = Number(input.modifiedAt);
  if (!name || !Number.isFinite(size) || size <= 0 || !Number.isFinite(modifiedAt) || modifiedAt <= 0) return null;
  return { name, size, modifiedAt };
}

/** A browser reports `lastModified` in whole milliseconds; some filesystems keep seconds. */
const SAME_TIME_MS = 2000;

async function matches(file: string, print: FileFingerprint): Promise<boolean> {
  try {
    const stat = await fs.stat(file);
    return stat.isFile() && stat.size === print.size && Math.abs(stat.mtimeMs - print.modifiedAt) <= SAME_TIME_MS;
  } catch { return false; }
}

/** Spotlight's answer for a name and an exact size, or nothing where there is no Spotlight. */
async function spotlight(print: FileFingerprint): Promise<string[]> {
  if (process.platform !== "darwin") return [];
  const query = `kMDItemFSName == "${print.name.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}" && kMDItemFSSize == ${print.size}`;
  return new Promise(resolve => {
    execFile("mdfind", [query], { timeout: 3000, maxBuffer: 1 << 20 }, (error, stdout) => {
      resolve(error ? [] : stdout.split("\n").map(line => line.trim()).filter(Boolean));
    });
  });
}

/**
 * The folders to look in when Spotlight has nothing: the picker's places, plus any the
 * caller names (the folder last browsed, say). Non-recursive: a name that sits deeper
 * than that is a name Spotlight knows.
 */
async function nearby(print: FileFingerprint, roots: string[]): Promise<string[]> {
  const folders = [...new Set([...roots, ...(await places()).filter(place => !place.blocked).map(place => place.path)])];
  return folders.map(folder => path.join(localPath(folder), print.name));
}

/**
 * The path of the file a browser handed over, if this machine has it. Spotlight first,
 * then the usual folders; every candidate is stat'd against the size and the time, so a
 * stale index or a same-named file elsewhere cannot answer. The workspace itself is
 * skipped: a clone already inside it is not the original anyone dropped.
 */
export async function resolveLocalFile(print: FileFingerprint, options: { roots?: string[]; workspace?: string } = {}): Promise<ResolvedLocalFile | null> {
  const kind = kindFor(print.name);
  if (!kind) return null;
  const candidates = [...await spotlight(print), ...await nearby(print, options.roots ?? [])];
  const home = os.homedir();
  // A hit under the home folder beats one on a mounted volume: it is the one that clones.
  candidates.sort((a, b) => Number(b.startsWith(home)) - Number(a.startsWith(home)));
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const file = path.resolve(candidate);
    if (seen.has(file)) continue;
    seen.add(file);
    if (options.workspace && file.startsWith(path.resolve(options.workspace) + path.sep)) continue;
    if (await matches(file, print)) return { file, kind, name: print.name };
  }
  return null;
}
