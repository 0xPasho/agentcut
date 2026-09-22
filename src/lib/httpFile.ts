import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import type { Stats } from "node:fs";

const CHUNK = 4 * 1024 * 1024;

/**
 * How long a served file may be reused without asking again.
 *
 * Every cut in a timeline mounts a fresh `<video>` on the same source, and a fresh
 * element re-reads the recording's header before it can show a frame — on a four-hour
 * capture that is tens of megabytes, which is why a splice went black for as long as
 * it did. A validator lets the browser's media cache keep those bytes across elements.
 * Five minutes is a playback session; after that one cheap revalidation says whether
 * the file moved under us, so re-ingesting a source is never served from a stale copy.
 */
const MAX_AGE = 300;

const TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".oga": "audio/ogg",
  ".flac": "audio/flac",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

/**
 * What this file is right now, as a strong validator: a rendered clip that is
 * overwritten in place, or a source that is re-ingested, changes size or date and so
 * changes its tag. Strong rather than weak because a range request is only allowed to
 * be answered from a cached prefix when the validator is strong.
 */
const tagFor = (stat: Stats) => `"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;

/** Range-aware file response — <video> and Remotion's Player both need it to seek. */
export async function fileResponse(filePath: string, headers: Headers | null): Promise<Response> {
  const stat = await fsp.stat(filePath).catch(() => null);
  if (!stat) return new Response("not found", { status: 404 });

  const type = TYPES[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
  // An SVG is a document. Nothing runs when one is drawn into an <img>, but opening
  // its URL directly would, so it is served sandboxed and never content-sniffed.
  const guard: Record<string, string> = type === "image/svg+xml"
    ? { "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox", "X-Content-Type-Options": "nosniff" }
    : {};

  const tag = tagFor(stat);
  const validators = {
    ETag: tag,
    "Last-Modified": stat.mtime.toUTCString(),
    "Cache-Control": `private, max-age=${MAX_AGE}`,
    "Accept-Ranges": "bytes",
  };

  // A cache asking whether what it holds is still current. This answers before the
  // range does, which is the order the spec asks for and what makes a revalidation
  // cost a header rather than a chunk.
  const validating = headers?.get("if-none-match");
  if (validating && validating.split(",").some((candidate) => candidate.trim() === tag)) {
    return new Response(null, { status: 304, headers: { ...validators, ...guard } });
  }

  const rangeHeader = headers?.get("range") ?? null;
  // `If-Range` is the browser saying "only send me the piece if the file is still the
  // one I already have part of". If it is not, the partial response would splice two
  // different files together, so the whole file goes back instead.
  const ifRange = headers?.get("if-range");
  const stale = Boolean(ifRange && ifRange.trim() !== tag && ifRange.trim() !== stat.mtime.toUTCString());
  const m = rangeHeader && !stale ? /bytes=(\d*)-(\d*)/.exec(rangeHeader) : null;

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
        ...validators,
        ...guard,
      },
    });
  }

  return new Response(Readable.toWeb(fs.createReadStream(filePath)) as ReadableStream, {
    headers: {
      "Content-Type": type,
      "Content-Length": String(stat.size),
      ...validators,
      ...guard,
    },
  });
}
