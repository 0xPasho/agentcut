import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { renderStill, selectComposition } from "@remotion/renderer";
import { projectDir } from "../../../common/server/config";
import { registerAsset, toAbs } from "../../media/server/assets";
import { getBundle } from "../../render/server/render";
import type { AssetRow } from "../../../common/server/db";
import type { ChatComment } from "./comments";

/**
 * The avatar as a data URL, fetched now. TikTok signs its avatar links and they expire
 * within days, so a picture that pointed at one would render as a broken image the next
 * time the video is exported. Failing that — a dead link, no network — the card draws
 * the author's initials, which is what the chat itself falls back to.
 */
async function avatarData(url: string): Promise<string> {
  if (!/^https?:\/\//.test(url)) return "";
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(6000) });
    const type = response.headers.get("content-type") ?? "";
    if (!response.ok || !type.startsWith("image/")) return "";
    const bytes = Buffer.from(await response.arrayBuffer());
    return `data:${type.split(";")[0]};base64,${bytes.toString("base64")}`;
  } catch {
    return "";
  }
}

/** Longer than this and the card is a wall of text; the start of a question is the question. */
const MAX_CHARS = 180;

/**
 * Draw a comment as a transparent picture and add it to the project's assets. The same
 * comment draws the same pixels, and the asset library keys on content, so choosing it
 * again reuses the picture already there instead of stacking copies.
 */
export async function commentCardAsset(projectId: string, comment: ChatComment): Promise<AssetRow> {
  const text = comment.text.length > MAX_CHARS ? `${comment.text.slice(0, MAX_CHARS - 1).trimEnd()}…` : comment.text;
  const inputProps = { platform: comment.platform, name: comment.name, text, avatar: await avatarData(comment.avatar) };
  const serveUrl = await getBundle();
  const composition = await selectComposition({ serveUrl, id: "CommentCard", inputProps });
  const dir = path.join(projectDir(projectId), "assets");
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${randomUUID()}.png`);
  try {
    await renderStill({ composition, serveUrl, output: file, inputProps, imageFormat: "png" });
    const asset = await registerAsset({
      file, kind: "image", scope: "project", projectId, source: "chat",
      name: `Comentario de ${comment.name}.png`, tags: `chat comment ${comment.platform} chat:${comment.id}`,
    });
    // A picture already in the library under another file keeps that one.
    if (path.resolve(toAbs(asset.path)) !== path.resolve(file)) await fs.rm(file, { force: true });
    return asset;
  } catch (error) {
    await fs.rm(file, { force: true });
    throw error;
  }
}
