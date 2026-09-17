import http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { AddressInfo } from "node:net";

const TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
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
  ".webm": "video/webm",
  ".jpg": "image/jpeg",
  ".png": "image/png",
};

export type FileServer = { url: string; close: () => Promise<void> };

/**
 * Remotion's `bundle({publicDir})` copies the directory into the bundle, which is
 * unusable for multi-gigabyte sources. Serving over loopback with Range support
 * lets both the renderer and the browser <Player> stream the same file.
 */
export async function serveDir(dir: string, registeredFiles: Record<string, string> = {}): Promise<FileServer> {
  const root = path.resolve(dir);

  const server = http.createServer(async (req, res) => {
    try {
      const name = decodeURIComponent((req.url ?? "/").split("?")[0]);
      // Explicit source aliases also support legacy projects referencing local files
      // outside the workspace, without exposing their parent directories.
      const registered = Object.hasOwn(registeredFiles, name) ? registeredFiles[name] : undefined;
      const target = registered ?? path.resolve(root, `.${name}`);
      if (!registered && target !== root && !target.startsWith(root + path.sep)) {
        res.writeHead(403).end("forbidden");
        return;
      }

      const stat = await fsp.stat(target);
      const type = TYPES[path.extname(target).toLowerCase()] ?? "application/octet-stream";
      const range = req.headers.range;

      if (range) {
        const m = /bytes=(\d*)-(\d*)/.exec(range);
        const start = m?.[1] ? Number(m[1]) : 0;
        // Same cap as the Next route: never answer an open-ended range with a
        // multi-gigabyte body.
        const end = m?.[2] ? Number(m[2]) : Math.min(stat.size - 1, start + 4 * 1024 * 1024 - 1);
        res.writeHead(206, {
          "Content-Range": `bytes ${start}-${end}/${stat.size}`,
          "Accept-Ranges": "bytes",
          "Content-Length": end - start + 1,
          "Content-Type": type,
        });
        fs.createReadStream(target, { start, end }).pipe(res);
        return;
      }

      res.writeHead(200, {
        "Content-Length": stat.size,
        "Content-Type": type,
        "Accept-Ranges": "bytes",
      });
      fs.createReadStream(target).pipe(res);
    } catch {
      res.writeHead(404).end("not found");
    }
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}
