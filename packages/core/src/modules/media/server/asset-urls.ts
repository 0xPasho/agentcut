import path from "node:path";
import { q } from "../../../common/server/db";
import { WORKSPACE } from "../../../common/server/config";
import type { Edl } from "../../editor/types";

/** Every asset reference an EDL makes, across images, sfx and music. */
export function assetRefs(edl: Edl): string[] {
  const refs = new Set<string>();
  for (const clip of [...edl.clips, ...(edl.sequences ?? []).flatMap(s => s.items.map(i => i.clip))]) {
    for (const edit of clip.edits) {
      if (edit.type === "image" || edit.type === "sfx" || edit.type === "music") {
        if (edit.src) refs.add(edit.src);
      }
    }
  }
  return [...refs];
}

const rel = (p: string) =>
  path.relative(WORKSPACE, path.resolve(p)).split(path.sep).map(encodeURIComponent).join("/");

/**
 * Map each reference to a URL served by the render-time file server, which is
 * rooted at the workspace. Library assets live outside the project directory, so
 * they can't be resolved by name alone.
 */
export function serverAssetUrls(edl: Edl, projectId: string, baseUrl: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const ref of assetRefs(edl)) {
    const row = q.getAsset(ref);
    out[ref] = row
      ? `${baseUrl}/${rel(path.join(WORKSPACE, row.path))}`
      : `${baseUrl}/${rel(path.join(WORKSPACE, "projects", projectId, "assets", ref))}`;
  }
  return out;
}
