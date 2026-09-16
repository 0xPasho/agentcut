import fs from "node:fs/promises";
import path from "node:path";
import { run, which } from "./bin";

export function isUrl(s: string) {
  return /^https?:\/\//i.test(s);
}

/**
 * Download with yt-dlp. Whether the user has the right to download a given video
 * is their call — this is a local tool operating on their behalf.
 */
export async function downloadUrl(url: string, dir: string, onLog?: (s: string) => void) {
  if (!(await which("yt-dlp"))) throw new Error("yt-dlp not found — run: brew install yt-dlp");
  const out = path.join(dir, "source.%(ext)s");
  onLog?.(`downloading ${url}`);
  await run("yt-dlp", [
    "-f", "bv*[height<=1080]+ba/b[height<=1080]/b",
    "--merge-output-format", "mp4",
    "--no-playlist",
    "-o", out,
    url,
  ], { timeoutMs: 30 * 60_000 });

  const files = await fs.readdir(dir);
  const found = files.find((f) => /^source\.(mp4|mkv|webm|mov)$/i.test(f));
  if (!found) throw new Error("yt-dlp finished but no source file was produced");
  return path.join(dir, found);
}

export async function titleFor(url: string): Promise<string> {
  try {
    const { stdout } = await run("yt-dlp", ["--no-playlist", "--print", "title", url], { timeoutMs: 60_000 });
    return stdout.trim().slice(0, 120) || url;
  } catch {
    return url;
  }
}
