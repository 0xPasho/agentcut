import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

const CHUNK = 4 * 1024 * 1024;

const TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".jpg": "image/jpeg",
  ".png": "image/png",
};

/** Range-aware file response — <video> and Remotion's Player both need it to seek. */
export async function fileResponse(filePath: string, rangeHeader: string | null): Promise<Response> {
  const stat = await fsp.stat(filePath).catch(() => null);
  if (!stat) return new Response("not found", { status: 404 });

  const type = TYPES[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
  const m = rangeHeader ? /bytes=(\d*)-(\d*)/.exec(rangeHeader) : null;

  if (m) {
    const start = m[1] ? Number(m[1]) : 0;
    // An open-ended range ("bytes=0-") is what <video> sends first. Answering it
    // with the whole file means a 1.3GB response before playback can start, which
    // is what made seeking in the editor take tens of seconds. Cap the chunk and
    // let the browser ask for more.
    const end = m[2] ? Number(m[2]) : Math.min(stat.size - 1, start + CHUNK - 1);
    const stream = fs.createReadStream(filePath, { start, end });
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      status: 206,
      headers: {
        "Content-Type": type,
        "Content-Length": String(end - start + 1),
        "Content-Range": `bytes ${start}-${end}/${stat.size}`,
        "Accept-Ranges": "bytes",
      },
    });
  }

  return new Response(Readable.toWeb(fs.createReadStream(filePath)) as ReadableStream, {
    headers: {
      "Content-Type": type,
      "Content-Length": String(stat.size),
      "Accept-Ranges": "bytes",
    },
  });
}
