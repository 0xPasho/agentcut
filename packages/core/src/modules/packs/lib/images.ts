import type { PackManifest } from "../types";

/**
 * A pack's pictures: the cover people see first when choosing one, and the screenshots
 * after it. They are for people, not for the agents; a pack's reference examples are
 * what the agents read.
 */

/** Every picture the manifest names, cover first. */
export const packImageFiles = (manifest: Pick<PackManifest, "cover" | "screenshots">): string[] =>
  [manifest.cover, ...manifest.screenshots].filter(Boolean);

const TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" };

/** The content type of a pack picture, from its extension; null for anything that is not one. */
export function packImageType(file: string): string | null {
  const ext = /\.([a-z0-9]+)$/i.exec(file)?.[1]?.toLowerCase() ?? "";
  return TYPES[ext] ?? null;
}

/**
 * The name a picture gets inside an installed pack's folder: by its role, not by the name
 * it had, so two pictures called `1.png` in different folders cannot overwrite each other.
 */
export function packImageName(role: "cover" | number, file: string): string {
  const ext = (/\.([a-z0-9]+)$/i.exec(file)?.[1] ?? "png").toLowerCase();
  return role === "cover" ? `cover.${ext}` : `screenshot-${role + 1}.${ext}`;
}
