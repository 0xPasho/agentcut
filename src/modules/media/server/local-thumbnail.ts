import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { WORKSPACE } from "../../../common/server/config";
import { grabFrame } from "./ffmpeg";
import { localPath } from "./local-assets";
import { kindFor } from "./assets";

/**
 * A picture of a file on this machine, so the browser can be looked at rather than read.
 * Images are served as they are; a video gives up one frame, cached under the workspace
 * keyed by path, size and date — seeking into a seven-gigabyte recording is not something
 * to repeat every time the list scrolls back. `null` is a file there is nothing to picture of.
 */
export async function localThumbnail(asked: string): Promise<string | null> {
  const file = await fs.realpath(localPath(asked));
  const stat = await fs.stat(file);
  if (!stat.isFile()) throw new Error("not a file");
  const kind = kindFor(file) ?? (/\.(mp4|mov|mkv|webm|m4v)$/i.test(file) ? "video" : null);
  if (kind === "image") return file;
  if (kind !== "video") return null;

  const dir = path.join(WORKSPACE, "cache", "thumbs");
  await fs.mkdir(dir, { recursive: true });
  const key = createHash("sha1").update(`${file}:${stat.size}:${stat.mtimeMs}`).digest("hex").slice(0, 16);
  const thumb = path.join(dir, `${key}.jpg`);
  const cached = await fs.stat(thumb).catch(() => null);
  // A second in rather than frame zero, which on a recording is usually still black.
  if (!cached?.size) await grabFrame(file, 1, thumb, 320);
  return thumb;
}
