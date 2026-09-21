"use client";
import { api, type AssetSummary } from "../client";
import type { Edl, MediaSource } from "../edl";
import { classifyFile, type DragKind } from "./dnd";

/** What one ingested file became, ready to place on a timeline. */
export type Imported = { kind: DragKind; media?: MediaSource; asset?: AssetSummary; name: string };

/**
 * One ingestion path for the Import button, a desktop drop on the timeline, and a drop on
 * the canvas. Video lands as project media through the same revision-checked route the
 * browser uses; images and audio land in the shared asset library.
 */
export async function importFiles(projectId: string, files: File[]): Promise<Imported[]> {
  const imported: Imported[] = [];
  for (const file of files) {
    const kind = classifyFile(file.name);
    if (!kind) continue;
    if (kind === "video") {
      const project = await api.getProject(projectId);
      const form = new FormData();
      form.append("file", file);
      form.append("expectedRevision", String(project.revision));
      const response = await fetch(`/api/projects/${projectId}/media`, { method: "POST", body: form });
      const body = await response.json() as { error?: string; edl?: Edl };
      if (!response.ok || !body.edl) throw new Error(body.error ?? `Could not import ${file.name}`);
      const media = body.edl.media.at(-1);
      if (!media) throw new Error(`Could not import ${file.name}`);
      imported.push({ kind, media, name: media.name });
    } else {
      const { asset } = await api.uploadAsset(file);
      imported.push({ kind, asset, name: asset.name });
    }
  }
  if (!imported.length) throw new Error("Those files are not video, image or audio.");
  return imported;
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
