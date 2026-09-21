import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { kindFor, registerAsset, toAbs } from "../assets";
import { projectDir } from "../config";
export type FolderEntry = {
  name: string; path: string; kind: "folder" | "video" | "image" | "audio";
  /** Bytes, or null for a folder and for anything that cannot be stat'd. */
  size: number | null;
  /** Last modification, in epoch milliseconds; 0 when it cannot be read. */
  modifiedAt: number;
};
export type FolderListing = { path: string; parent: string | null; entries: FolderEntry[]; total: number; offset: number; nextOffset: number | null };
/** A shortcut in the picker's sidebar. `blocked` is a macOS privacy refusal, not a bug. */
export type Place = { name: string; path: string; blocked: boolean };
/** What the human's file browser gets: a listing, plus where it can jump to. */
export type FilesResponse = FolderListing & { home: string; places: Place[] };
export const localPath = (file: string) => path.resolve(file.replace(/^~(?=\/|$)/, os.homedir()));
/**
 * Explicit, nonrecursive browsing of the folder selected by the human or agent. Size and
 * date come back with the name because choosing between `dia-169.mp4` and `dia-172.mp4`
 * is done on "which is the seven-gigabyte one from last night", by either of them.
 */
export async function browseLocalFolder(folder?: string, offset = 0, limit = 100): Promise<FolderListing> {
  const root = await fs.realpath(folder ? localPath(folder) : os.homedir());
  const files = await fs.readdir(root, { withFileTypes: true });
  const found: Array<Pick<FolderEntry, "name" | "path" | "kind">> = [];
  for (const file of files) {
    if (file.name.startsWith(".")) continue;
    const kind = file.isDirectory() ? "folder" : file.isFile() ? kindFor(file.name) ?? (/\.(mp4|mov|mkv|webm|m4v)$/i.test(file.name) ? "video" : null) : null;
    if (kind) found.push({ name: file.name, path: path.join(root, file.name), kind });
  }
  found.sort((a,b) => Number(b.kind === "folder")-Number(a.kind === "folder") || a.name.localeCompare(b.name));
  const page = found.slice(offset, offset + limit);
  // Only the page is stat'd: a folder of thousands of downloads should not pay for
  // details nobody is about to read.
  const entries = await Promise.all(page.map(async entry => {
    const stat = await fs.stat(entry.path).catch(() => null);
    return { ...entry, size: entry.kind === "folder" ? null : stat?.size ?? null, modifiedAt: stat?.mtimeMs ?? 0 };
  }));
  return { path: root, parent: path.dirname(root) === root ? null : path.dirname(root), entries, total: found.length, offset, nextOffset: offset + limit < found.length ? offset + limit : null };
}
/** Imported media belongs to the workspace; originals are never modified. */
export async function importLocalAsset(projectId: string, source: string) {
  const original = await fs.realpath(localPath(source));
  const kind = kindFor(original);
  if (!kind || !(await fs.stat(original)).isFile()) throw new Error("Choose an image, audio or video file.");
  const dir = path.join(projectDir(projectId), "assets");
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${randomUUID()}${path.extname(original)}`);
  try {
    await fs.copyFile(original, file);
    const asset = await registerAsset({ file, kind, name: path.basename(original), scope: "project", projectId, source: "local-import" });
    if (path.resolve(toAbs(asset.path)) !== path.resolve(file)) await fs.rm(file, { force: true });
    return asset;
  } catch (error) { await fs.rm(file, { force: true }); throw error; }
}

/**
 * Import every supported image or audio file in a folder, in filename order. A
 * template's picture pool is a folder of screenshots, and importing them one call
 * at a time is not something either interface should have to script.
 */
export async function importLocalFolder(projectId: string, folder: string, limit = 200) {
  const root = await fs.realpath(localPath(folder));
  const entries = await fs.readdir(root, { withFileTypes: true });
  const files = entries
    .filter(entry => entry.isFile() && !entry.name.startsWith(".") && kindFor(entry.name))
    .map(entry => entry.name)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }))
    .slice(0, limit);
  if (!files.length) throw new Error(`No images or audio in ${root}.`);
  const imported = [];
  const failed: string[] = [];
  for (const name of files) {
    try { imported.push(await importLocalAsset(projectId, path.join(root, name))); }
    catch (error) { failed.push(`${name}: ${(error as Error).message}`); }
  }
  return { folder: root, imported, failed };
}
