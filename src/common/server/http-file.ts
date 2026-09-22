import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import type { Stats } from "node:fs";

const CHUNK = 4 * 1024 * 1024;

/**
 * Reuse the bytes, never the answer.
 *
 * Every cut in a timeline mounts a fresh `<video>` on the same source, and a fresh
 * element re-reads the recording's header before it can show a frame — on a four-hour
 * capture that is tens of megabytes, which is why a splice went black for as long as it
 * did. A validator lets the browser's media cache keep those bytes across elements.
 *
 * `no-cache` is not "do not cache": it is "ask first, every time". A freshness window
 * would be faster by one conditional request on a local socket and wrong for as long as
 * it lasted — a clip re-rendered in place, or a source re-ingested, keeps its URL, and a
 * video editor that shows you the take you just replaced is worse than any millisecond
 * this would buy. The ask is answered with a 304 and the browser reuses what it holds.
 */
const CACHE_CONTROL = "private, no-cache";

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
    "Cache-Control": CACHE_CONTROL,
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
    // "bytes=-N" is not "from zero to N": it asks for the LAST N bytes, which is how a
    // player reaches the index of an mp4 that was not written for streaming — and this
    // answered it with the opening of the file, so the reader had to go looking again.
    const suffix = !m[1] && Boolean(m[2]);
    // An open-ended range ("bytes=0-") is what <video> sends first. Answering it
    // with the whole file means a 1.3GB response before playback can start, which
    // is what made seeking in the editor take tens of seconds. Cap the chunk and
    // let the browser ask for more. A suffix range is capped from its own end, so
    // what comes back is still the tail the reader asked for, just less of it.
    const start = suffix
      ? Math.max(0, stat.size - Math.min(Number(m[2]), CHUNK))
      : m[1] ? Number(m[1]) : 0;
    const end = suffix ? stat.size - 1 : Math.min(stat.size - 1, m[2] ? Number(m[2]) : start + CHUNK - 1);
    // A range that starts past the end, or ends before it starts, has no bytes to send.
    // Saying so is a 416 with the real length; reading it was a stream error and a 500.
    if (!Number.isFinite(start) || start < 0 || start >= stat.size || end < start) {
      return new Response("range not satisfiable", {
        status: 416,
        headers: { "Content-Range": `bytes */${stat.size}`, ...validators, ...guard },
      });
    }
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
