import { api, type AssetSummary } from "./client";
import { classifyFile, type MediaKind } from "../lib/files";
import type { Edl, MediaSource } from "../../modules/editor/types";

/**
 * The one way a file from this computer enters the workspace, whatever the gesture.
 *
 * A drop, a paste and a file input all hand the browser bytes and hide the path. But
 * they say the name, the size and the modification time, and the server can find the
 * file from those and clone it: instant, and no second copy on disk. So every surface
 * first asks where the file is, and only streams the bytes when this machine does not
 * have it (a file from another volume, or a paste that was never a file).
 *
 * Where the file lands is the caller's: a project's media or assets, or the library.
 */

/** A file that arrived, and by which door. `linked` is a clone of a file found on this disk. */
export type Ingested = { kind: MediaKind; name: string; linked: boolean; media?: MediaSource; asset?: AssetSummary };

export type IngestTarget =
  /**
   * Video becomes the project's media, pictures and sounds its assets. With `as:
   * "assets"` a video is an asset too: something shown to the agent, which places it
   * through `media.import` when the message says to.
   */
  | { projectId: string; transcribe?: boolean; as?: "assets" }
  /** Everything becomes a library asset, reusable by any project. */
  | { library: true };

/** Where the file is on this machine, or nothing. Never throws: a failed lookup is an upload. */
export async function locate(file: File, roots: string[] = []) {
  try { return await api.resolveLocalFile(file, roots); } catch { return null; }
}

async function importVideo(projectId: string, file: File, transcribe?: boolean): Promise<Ingested> {
  const found = await locate(file);
  const { revision } = await api.getProject(projectId);
  const result = found
    ? await api.editorTool<{ edl: Edl }>(projectId, { tool: "media.import", file: found.file, expectedRevision: revision, ...(transcribe === undefined ? {} : { transcribe }) })
    : await api.uploadProjectMedia(projectId, file, revision, transcribe);
  const media = result.edl.media.at(-1);
  if (!media) throw new Error(`Could not import ${file.name}`);
  return { kind: "video", name: media.name, linked: !!found, media };
}

async function importAsset(file: File, projectId?: string): Promise<Ingested> {
  const kind = classifyFile(file.name);
  if (!kind) throw new Error(`${file.name} is not a video, image or audio file.`);
  const found = await locate(file);
  const { asset } = found ? await api.importLocalAsset(found.file, projectId) : await api.uploadAsset(file, projectId);
  return { kind, name: asset.name, linked: !!found, asset };
}

/**
 * Files from the browser, in order, into `target`. Stops at the first failure: the
 * files before it are already in, and the error names the one that is not.
 */
export async function ingestFiles(files: File[], target: IngestTarget): Promise<Ingested[]> {
  const supported = files.filter((file) => classifyFile(file.name));
  if (!supported.length) throw new Error("Those files are not video, image or audio.");
  const out: Ingested[] = [];
  for (const file of supported) {
    if ("library" in target) { out.push(await importAsset(file)); continue; }
    const asMedia = classifyFile(file.name) === "video" && target.as !== "assets";
    out.push(asMedia ? await importVideo(target.projectId, file, target.transcribe) : await importAsset(file, target.projectId));
  }
  return out;
}

/** A long video dropped on the home screen: a new project around its clone, or its upload. */
export async function ingestSource(file: File): Promise<{ id: string; name: string; linked: boolean }> {
  const found = await locate(file);
  const created = found ? await api.createProject(found.file) : await api.uploadProject(file);
  return { ...created, linked: !!found };
}

/** One sentence for the toast: what came in, and whether it was found here rather than uploaded. */
export function ingestNotice(entries: Ingested[], verb = "imported") {
  const what = entries.length === 1 ? entries[0].name : `${entries.length} files`;
  return entries.every((entry) => entry.linked) ? `${what} ${verb} from this computer, nothing uploaded.` : `${what} ${verb}.`;
}
