import path from "node:path";
import { FFMPEG, FFPROBE, run } from "./bin";

export type Probe = {
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
  videoCodec: string | null;
  audioCodec: string | null;
};

function parseFps(r: string | undefined): number {
  if (!r) return 0;
  const [n, d] = r.split("/").map(Number);
  return d ? n / d : n || 0;
}

export async function probe(file: string): Promise<Probe> {
  const { stdout } = await run(FFPROBE, [
    "-v", "error",
    "-print_format", "json",
    "-show_format",
    "-show_streams",
    file,
  ]);
  const json = JSON.parse(stdout) as {
    format?: { duration?: string };
    streams?: Array<Record<string, string | number>>;
  };
  const streams = json.streams ?? [];
  const v = streams.find((s) => s.codec_type === "video");
  const a = streams.find((s) => s.codec_type === "audio");
  return {
    durationSec: Number(json.format?.duration ?? 0),
    width: Number(v?.width ?? 0),
    height: Number(v?.height ?? 0),
    fps: parseFps(v?.avg_frame_rate as string) || parseFps(v?.r_frame_rate as string),
    hasAudio: Boolean(a),
    videoCodec: (v?.codec_name as string) ?? null,
    audioCodec: (a?.codec_name as string) ?? null,
  };
}

/** 16kHz mono WAV — what every whisper implementation wants. */
export async function extractAudio(src: string, dest: string) {
  await run(FFMPEG, [
    "-y", "-i", src,
    "-vn", "-ac", "1", "-ar", "16000",
    "-c:a", "pcm_s16le",
    dest,
  ]);
  return dest;
}

/** Scene-change timestamps (seconds). Threshold 0..1; 0.3 is a sane default. */
export async function detectScenes(src: string, threshold = 0.3): Promise<number[]> {
  const { stderr } = await run(FFMPEG, [
    "-i", src,
    "-filter:v", `select='gt(scene,${threshold})',showinfo`,
    "-f", "null", "-",
  ]);
  const times = new Set<number>([0]);
  for (const m of stderr.matchAll(/pts_time:([0-9.]+)/g)) times.add(Number(m[1]));
  return [...times].sort((a, b) => a - b);
}

/** Per-second loudness in dB. Laughter/applause/emphasis show up as peaks. */
export async function loudnessCurve(src: string): Promise<Array<{ t: number; db: number }>> {
  const { stderr } = await run(FFMPEG, [
    "-i", src,
    "-filter:a", "astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level",
    "-f", "null", "-",
  ]);
  const out: Array<{ t: number; db: number }> = [];
  const re = /pts_time:([0-9.]+)[\s\S]*?RMS_level=(-?[0-9.]+|-inf)/g;
  for (const m of stderr.matchAll(re)) {
    const db = m[2] === "-inf" ? -100 : Number(m[2]);
    out.push({ t: Number(m[1]), db });
  }
  return out;
}

/** Sample a frame as JPEG so the agent can actually look at the video. */
export async function grabFrame(src: string, atSec: number, dest: string, width = 640) {
  await run(FFMPEG, [
    "-y", "-ss", String(atSec), "-i", src,
    "-frames:v", "1",
    "-vf", `scale=${width}:-2`,
    "-q:v", "4",
    dest,
  ]);
  return dest;
}

/** Lossless-ish cut for previews. Real renders go through Remotion. */
export async function cut(src: string, start: number, end: number, dest: string) {
  await run(FFMPEG, [
    "-y", "-ss", String(start), "-to", String(end), "-i", src,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
    "-c:a", "aac", "-b:a", "128k",
    "-movflags", "+faststart",
    dest,
  ]);
  return dest;
}

export const ext = (f: string) => path.extname(f).toLowerCase();
