import fs from "node:fs/promises";
import path from "node:path";
import { kindFor } from "../../media/server/assets";
import { PACK_IMAGE_MAX_BYTES, PACK_IMAGES_DIR, PACK_SCREENSHOTS_MAX } from "../data";
import { packImageName, packImageType } from "../lib/images";
import type { PackImages } from "../types";
import { packFolder } from "./packs";
import { packRecord, writeRecord } from "./style";

/**
 * A pack's pictures, as installed in this workspace: the cover and the screenshots that
 * show people what the pack makes. They live in `packs/<id>/images/` and travel when the
 * pack is exported. The pack's page and the agent tools (`packs.images.*`) are these
 * functions.
 */

export async function readImages(id: string): Promise<PackImages> {
  const pack = await packRecord(id);
  return { pack: pack.id, name: pack.name, cover: pack.cover, screenshots: pack.screenshots };
}

/**
 * Copy a picture into the pack, as its cover (replacing the one it had) or as one more
 * screenshot. Refused when it is not a png, jpg, webp or gif, or heavier than a card can carry.
 */
export async function addImage(id: string, source: string, as: "cover" | "screenshot" = "screenshot") {
  const pack = await packRecord(id);
  const original = path.resolve(source.replace(/^~(?=\/)/, process.env.HOME ?? "~"));
  if (kindFor(original) !== "image" || !packImageType(original)) throw new Error("A pack picture is a png, jpg, webp or gif.");
  const { size } = await fs.stat(original);
  if (size > PACK_IMAGE_MAX_BYTES) throw new Error(`That picture is ${(size / 1024 / 1024).toFixed(1)} MB; a pack picture is at most ${PACK_IMAGE_MAX_BYTES / 1024 / 1024} MB.`);
  if (as === "screenshot" && pack.screenshots.length >= PACK_SCREENSHOTS_MAX) {
    throw new Error(`${pack.name} already has ${PACK_SCREENSHOTS_MAX} screenshots. Remove one first.`);
  }
  await fs.mkdir(path.join(packFolder(id), PACK_IMAGES_DIR), { recursive: true });
  if (as === "cover") {
    if (pack.cover) await fs.rm(path.join(packFolder(id), pack.cover), { force: true });
    pack.cover = `${PACK_IMAGES_DIR}/${packImageName("cover", original)}`;
    await fs.copyFile(original, path.join(packFolder(id), pack.cover));
  } else {
    // Numbered after the highest one there, so removing a middle one never reuses a name.
    const taken = pack.screenshots.map((f) => Number(/screenshot-(\d+)\./.exec(f)?.[1] ?? 0));
    const file = `${PACK_IMAGES_DIR}/${packImageName(Math.max(0, ...taken), original)}`;
    await fs.copyFile(original, path.join(packFolder(id), file));
    pack.screenshots = [...pack.screenshots, file];
  }
  await writeRecord(pack);
  return readImages(id);
}

/** Take a picture out of the pack: its cover or one of its screenshots. */
export async function removeImage(id: string, file: string) {
  const pack = await packRecord(id);
  if (file !== pack.cover && !pack.screenshots.includes(file)) throw new Error(`${pack.name} has no picture ${file}.`);
  await fs.rm(path.join(packFolder(id), file), { force: true });
  if (file === pack.cover) pack.cover = "";
  pack.screenshots = pack.screenshots.filter((f) => f !== file);
  await writeRecord(pack);
  return readImages(id);
}
