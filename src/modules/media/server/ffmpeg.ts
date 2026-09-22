import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { FFMPEG, FFPROBE, run } from "../../../common/server/bin";

export type Probe = {
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
  videoCodec: string | null;
  audioCodec: string | null;
  /**
   * When the recording began, epoch ms, from the container's `creation_time`. A stream
   * recording carries it — Restream stamps the moment the stream went live — and it is
   * what puts the stream's chat on the video's clock. `null` when the file does not say.
   */
  recordedAt: number | null;
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
    format?: { duration?: string; tags?: Record<string, string> };
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
    recordedAt: recordedAt(json.format?.tags?.creation_time, file),
  };
}

/**
 * The container's own timestamp, or failing that the one OBS writes into the file name
 * ("2026-09-13 19-54-32.mp4", local time). An encoder that stamps the Unix epoch is
 * saying it does not know, not that the video is from 1970.
 */
function recordedAt(stamp: string | undefined, file: string): number | null {
  const parsed = stamp ? Date.parse(stamp) : NaN;
  if (Number.isFinite(parsed) && parsed > Date.UTC(2000, 0, 1)) return parsed;
  const named = path.basename(file).match(/(\d{4})-(\d{2})-(\d{2})[ _T](\d{2})-(\d{2})-(\d{2})/);
  if (!named) return null;
  const [, y, mo, d, h, mi, se] = named.map(Number);
  return new Date(y, mo - 1, d, h, mi, se).getTime();
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

/** How often the loudness curve is sampled, in seconds. */
export const LOUDNESS_STEP_SEC = 0.5;

/**
 * Loudness in dB, twice a second. Laughter, applause and emphasis show up as peaks.
 *
 * astats resets once per audio frame, and a decoded frame is about 23ms, so this used
 * to print one reading every 23ms — 7.2kB of stderr per second of audio. A four-hour
 * recording is 114MB of it, past the 64MB `run` will hold, so the pass failed and the
 * caller's catch turned that into "this video has no loud moments at all": every
 * source over about two and a half hours silently lost the signal, which is exactly
 * the length of source this is for. Half-second frames are 6MB for the same file, and
 * nothing downstream wants a reaction located to the millisecond.
 */
export async function loudnessCurve(
  src: string,
  /** Only this stretch, in seconds of the source. The readings still carry its own clock. */
  span?: { start?: number; duration?: number },
  /**
   * Seconds per reading. Half a second is right for finding reactions in hours of
   * stream; checking whether a one-second pause is really quiet needs twentieths.
   */
  stepSec = LOUDNESS_STEP_SEC,
): Promise<Array<{ t: number; db: number }>> {
  // Resample first so the frame size is a known number of samples whatever the source is.
  const samples = Math.round(48000 * stepSec);
  const seek = span?.start ? ["-ss", String(span.start)] : [];
  const length = span?.duration ? ["-t", String(span.duration)] : [];
  const { stderr } = await run(FFMPEG, [
    ...seek, "-i", src, ...length,
    "-filter:a", `aresample=48000,asetnsamples=n=${samples}:p=0,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level`,
    "-f", "null", "-",
  ]);
  const out: Array<{ t: number; db: number }> = [];
  const re = /pts_time:([0-9.]+)[\s\S]*?RMS_level=(-?[0-9.]+|-inf)/g;
  // Seeking restarts the clock at zero, so a span's readings are put back on the
  // source's own timeline: every caller that has one is asking about a place in a file.
  const offset = span?.start ?? 0;
  for (const m of stderr.matchAll(re)) {
    const db = m[2] === "-inf" ? -100 : Number(m[2]);
    out.push({ t: Number(m[1]) + offset, db });
  }
  return out;
}

/**
 * How loud a file's audio actually is, in dBFS, from one ffmpeg pass.
 *
 * This is the cheap signal that decides whether a newly imported source is worth
 * recognising: digital silence and a muted camera track peak around -91 dB, while
 * anything with a voice in it peaks far above -50. It answers "is there sound
 * here", not "is there speech here" — a room-tone b-roll clip still counts as
 * sound, and that is the honest limit of a test that costs a decode.
 *
 * `null` means there is no audio stream to measure, or ffmpeg could not read one.
 */
export async function audioLevel(src: string, span?: { start?: number; duration?: number }): Promise<{ maxDb: number; meanDb: number } | null> {
  try {
    // A span, when the caller has one: the peak of a four-hour stream says nothing about
    // the forty seconds being cut out of it, and decoding the whole of it to find out
    // costs a minute per clip.
    const seek = span?.start ? ["-ss", String(span.start)] : [];
    const length = span?.duration ? ["-t", String(span.duration)] : [];
    const { stderr } = await run(FFMPEG, [...seek, "-i", src, ...length, "-vn", "-af", "volumedetect", "-f", "null", "-"]);
    const max = stderr.match(/max_volume:\s*(-?[0-9.]+) dB/);
    if (!max) return null;
    const mean = stderr.match(/mean_volume:\s*(-?[0-9.]+) dB/);
    const maxDb = Number(max[1]);
    return { maxDb, meanDb: mean ? Number(mean[1]) : maxDb };
  } catch {
    return null;
  }
}

/**
 * Integrated loudness, in LUFS, of a file or a span of one.
 *
 * Mean level is the wrong measure for comparing two pieces of sound: a speech clip is
 * half pauses and a music sting is continuous, so their means differ by ten decibels
 * while they sound the same, and matching on the mean makes the quiet one blare. LUFS
 * is the measure that says which of two things sounds louder.
 *
 * `null` when there is nothing to measure or ffmpeg could not read it — the caller then
 * leaves the sound alone, which is what every project did before this.
 */
export async function loudness(src: string, span?: { start?: number; duration?: number }): Promise<number | null> {
  try {
    const seek = span?.start ? ["-ss", String(span.start)] : [];
    const length = span?.duration ? ["-t", String(span.duration)] : [];
    const { stderr } = await run(FFMPEG, [...seek, "-i", src, ...length, "-vn", "-af", "ebur128=framelog=quiet", "-f", "null", "-"]);
    const found = stderr.match(/I:\s*(-?[0-9.]+)\s*LUFS/);
    const value = found ? Number(found[1]) : NaN;
    // A span with no sound in it measures as -70 or lower and says nothing useful.
    return Number.isFinite(value) && value > -70 ? value : null;
  } catch {
    return null;
  }
}

/** Below this peak a file is silence, not quiet speech. Speech never lives down here. */
export const SILENCE_PEAK_DB = -50;

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

/**
 * The loudness envelope of a file's audio, as RMS buckets normalised to 0..1.
 *
 * Drawing a shot's own audio in the editor needs the shape of the whole file, and a
 * two-hour stream is gigabytes: decoding it in the browser, which is what the library
 * assets do, is not an option. ffmpeg resamples it to a rate that is already close to
 * the drawing resolution, so the array that crosses the wire is the picture itself.
 */
export async function audioPeaks(src: string, perSecond = 10): Promise<{ rate: number; peaks: number[] }> {
  const RATE = 2000;
  const bucket = Math.max(1, Math.round(RATE / perSecond));
  const tmp = path.join(os.tmpdir(), `agentcut-peaks-${randomUUID().slice(0, 8)}.pcm`);
  try {
    await run(FFMPEG, ["-y", "-i", src, "-vn", "-ac", "1", "-ar", String(RATE), "-f", "s16le", tmp]);
    const bytes = await fs.readFile(tmp);
    const samples = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
    const peaks: number[] = [];
    let loudest = 0;
    for (let start = 0; start < samples.length; start += bucket) {
      const stop = Math.min(samples.length, start + bucket);
      let sum = 0;
      for (let i = start; i < stop; i++) sum += (samples[i] / 32768) ** 2;
      const energy = Math.sqrt(sum / Math.max(1, stop - start));
      peaks.push(energy);
      loudest = Math.max(loudest, energy);
    }
    // A quiet recording should still read as a shape, so the loudest bucket sets the ceiling.
    return { rate: perSecond, peaks: loudest > 0 ? peaks.map(p => Math.round((p / loudest) * 1000) / 1000) : peaks };
  } catch {
    // A file with no audio track is normal — silent screen recordings, image sequences.
    // The timeline draws a plain block for it, the same as an undecodable asset.
    return { rate: perSecond, peaks: [] };
  } finally {
    await fs.rm(tmp, { force: true });
  }
}
