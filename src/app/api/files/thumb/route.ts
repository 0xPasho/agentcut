import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { WORKSPACE } from "@/lib/config";
import { grabFrame } from "@/lib/media";
import { fileResponse } from "@/lib/httpFile";
import { localPath } from "@/lib/editor/local-assets";
import { kindFor } from "@/lib/assets";

export const runtime = "nodejs";

/**
 * A picture of a file on this machine, so the browser can be looked at rather than read.
 * Images are served as they are; a video gives up one frame, cached under the workspace
 * keyed by path, size and date — seeking into a seven-gigabyte recording is not something
 * to repeat every time the list scrolls back.
 */
export async function GET(req: NextRequest) {
  const asked = req.nextUrl.searchParams.get("path");
  if (!asked) return new Response("path required", { status: 400 });

  try {
    const file = await fs.realpath(localPath(asked));
    const stat = await fs.stat(file);
    if (!stat.isFile()) return new Response("not a file", { status: 400 });

    const kind = kindFor(file) ?? (/\.(mp4|mov|mkv|webm|m4v)$/i.test(file) ? "video" : null);
    if (kind === "image") {
      const res = await fileResponse(file, null);
      res.headers.set("Cache-Control", "private, max-age=3600");
      return res;
    }
    if (kind !== "video") return new Response("nothing to picture", { status: 404 });

    const dir = path.join(WORKSPACE, "cache", "thumbs");
    await fs.mkdir(dir, { recursive: true });
    const key = createHash("sha1").update(`${file}:${stat.size}:${stat.mtimeMs}`).digest("hex").slice(0, 16);
    const thumb = path.join(dir, `${key}.jpg`);
    const cached = await fs.stat(thumb).catch(() => null);
    // A second in rather than frame zero, which on a recording is usually still black.
    if (!cached?.size) await grabFrame(file, 1, thumb, 320);

    const res = await fileResponse(thumb, null);
    res.headers.set("Cache-Control", "private, max-age=3600");
    return res;
  } catch (e) {
    return new Response((e as Error).message, { status: 404 });
  }
}
