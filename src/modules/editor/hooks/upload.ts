"use client";
import { api, type AssetSummary } from "../../../common/api/client";
import { ingestFiles, type Ingested } from "../../../common/api/ingest";
import type { Edl } from "../types";
import { type DragKind } from "../lib/dnd";
import { type Imported } from "../types";

/**
 * One ingestion path for the Import button, a desktop drop on the timeline, and a drop on
 * the canvas: `ingestFiles`, which finds each file on this disk and clones it, or streams
 * it when it is not here. Video lands as project media against the current revision;
 * images and audio become the project's assets.
 */
export function importFiles(projectId: string, files: File[]): Promise<Array<Imported & Pick<Ingested, "linked">>> {
  return ingestFiles(files, { projectId });
}

/** How much timeline an imported file will occupy, before any trim. */
export const importedDuration = (entry: Imported) =>
  entry.media?.durationSec ?? entry.asset?.duration_sec ?? (entry.kind === "image" ? 3 : 8);

/**
 * A file the user picked in the folder browser. It takes the same services as an upload:
 * video is registered as project media against the current revision, everything else
 * lands in the asset library.
 */
export async function importLocalFile(projectId: string, file: string, kind: DragKind): Promise<Imported> {
  if (kind === "video") {
    const project = await api.getProject(projectId);
    const result = await api.editorTool<{ edl: Edl }>(projectId, { tool: "media.import", file, expectedRevision: project.revision });
    const media = result.edl.media.at(-1);
    if (!media) throw new Error("That video could not be imported");
    return { kind, media, name: media.name };
  }
  const asset = await api.editorTool<AssetSummary>(projectId, { tool: "assets.importLocal", file });
  return { kind, asset, name: asset.name };
}

/** An online search result becomes a library asset before it can be placed. */
export async function adoptSearchHit(projectId: string, hit: { provider: string; id: string; query: string; providers?: string[] }): Promise<Imported> {
  const asset = await api.editorTool<AssetSummary>(projectId, {
    tool: "assets.adopt", query: hit.query, provider: hit.provider, id: hit.id,
    ...(hit.providers?.length ? { providers: hit.providers } : {}),
  });
  return { kind: "image", asset, name: asset.name };
}
