import fs from "node:fs/promises";
import path from "node:path";
import { run, which } from "../../../common/server/bin";
import { ffmpegBinDir } from "../../../common/server/ffmpeg-dir";

export { isUrl } from "../../../common/lib/urls";

const CONTAINERS = /^source\.(mp4|mkv|webm|mov)$/i;
/** Per-stream downloads yt-dlp leaves behind when a merge fails, e.g. source.f399.mp4 */
const FRAGMENT = /^source\.f\d+\./i;

/**
 * Download with yt-dlp. Whether the user has the right to download a given video
 * is their call — this is a local tool operating on their behalf.
 *
 * 720p by default: clips are rendered at 1080x1920 from a centre-ish crop, so a
 * 1080p source costs several gigabytes of download for detail the crop discards.
 */
export async function downloadUrl(
  url: string,
  dir: string,
  onLog?: (s: string) => void,
  maxHeight = Number(process.env.AGENTCUT_MAX_HEIGHT ?? 720),
) {
  if (!(await which("yt-dlp"))) throw new Error("yt-dlp not found — run: brew install yt-dlp");

  // A previous failed attempt leaves unmerged streams that would confuse detection.
  for (const f of await fs.readdir(dir).catch(() => [])) {
    if (FRAGMENT.test(f)) await fs.rm(path.join(dir, f), { force: true });
  }

  onLog?.(`downloading ${url} (up to ${maxHeight}p)`);
  const { stderr } = await run("yt-dlp", [
    // Prefer H.264 + m4a: the merge is a plain remux, and every later step
    // (frame sampling, Remotion render) decodes it far faster than AV1.
    "-f",
    `bv*[vcodec^=avc1][height<=${maxHeight}]+ba[ext=m4a]/bv*[height<=${maxHeight}]+ba/b[height<=${maxHeight}]/b`,
    "--merge-output-format", "mp4",
    "--ffmpeg-location", await ffmpegBinDir(),
    "--no-playlist",
    "--no-progress",
    "--newline",
    "-o", path.join(dir, "source.%(ext)s"),
    url,
  ], { timeoutMs: 60 * 60_000 });

  const files = await fs.readdir(dir);
  const found = files.find((f) => CONTAINERS.test(f));
  if (found) return path.join(dir, found);

  const fragments = files.filter((f) => FRAGMENT.test(f));
  if (fragments.length) {
    throw new Error(
      `yt-dlp downloaded the streams but could not merge them (${fragments.join(", ")}). ` +
        `This is an ffmpeg failure: ${stderr.trim().split("\n").slice(-2).join(" ") || "no details"}`,
    );
  }
  throw new Error(
    `yt-dlp produced no video. Last output: ${stderr.trim().split("\n").slice(-3).join(" ") || "none"}`,
  );
}

export async function titleFor(url: string): Promise<string> {
  try {
    const { stdout } = await run("yt-dlp", ["--no-playlist", "--print", "title", url], { timeoutMs: 60_000 });
    return stdout.trim().slice(0, 120) || url;
  } catch {
    return url;
  }
}
