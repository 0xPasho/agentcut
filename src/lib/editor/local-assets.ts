import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { kindFor, registerAsset, toAbs } from "../assets";
import { projectDir } from "../config";
export type FolderEntry = { name: string; path: string; kind: "folder" | "video" | "image" | "audio" };
export type FolderListing = { path: string; parent: string | null; entries: FolderEntry[]; total: number; offset: number; nextOffset: number | null };
export const localPath = (file: string) => path.resolve(file.replace(/^~(?=\/|$)/, os.homedir()));
/** Explicit, nonrecursive browsing of the folder selected by the human or agent. */
export async function browseLocalFolder(folder?: string, offset = 0): Promise<FolderListing> {
  const root = await fs.realpath(folder ? localPath(folder) : os.homedir());
  const files = await fs.readdir(root, { withFileTypes: true });
  const entries: FolderEntry[] = [];
  for (const file of files) {
    if (file.name.startsWith(".")) continue;
    const kind = file.isDirectory() ? "folder" : file.isFile() ? kindFor(file.name) ?? (/\.(mp4|mov|mkv|webm|m4v)$/i.test(file.name) ? "video" : null) : null;
    if (kind) entries.push({ name: file.name, path: path.join(root, file.name), kind });
  }
  entries.sort((a,b) => Number(b.kind === "folder")-Number(a.kind === "folder") || a.name.localeCompare(b.name));
  return { path: root, parent: path.dirname(root) === root ? null : path.dirname(root), entries: entries.slice(offset, offset+100), total: entries.length, offset, nextOffset: offset+100 < entries.length ? offset+100 : null };
}
/** Imported media belongs to the workspace; originals are never modified. */
export async function importLocalAsset(projectId: string, source: string) {
  const original = await fs.realpath(localPath(source));
  const kind = kindFor(original);
  if (!kind || !(await fs.stat(original)).isFile()) throw new Error("Choose an image or audio file. Import videos through media.import.");
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
