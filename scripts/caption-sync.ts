/**
 * Are this project's captions on the words?
 *
 *   tsx scripts/caption-sync.ts <projectId> [sequenceId]
 *
 * Reads each video's own footage, marks what is loud enough to be speech, and slides the
 * transcript against it. A shift inside one frame is not a problem; a consistent shift
 * across every video is what `captions.syncOffsetMs` is for.
 */
import { spawnSync } from "node:child_process";
import { FFMPEG } from "../src/common/server/bin";
import { readEditor } from "../src/modules/editor/server/store";
import { readSync, speechMask } from "../src/modules/transcription/lib/sync";

const STEP = 0.02;

/** RMS every 20ms over one span of a file, as decibels. */
function envelope(file: string, start: number, duration: number): number[] {
  const out = spawnSync(FFMPEG, ["-v", "error", "-ss", String(start), "-t", String(duration), "-i", file,
    "-vn", "-ac", "1", "-ar", "16000", "-f", "f32le", "-"], { maxBuffer: 1 << 28 });
  if (out.status !== 0) throw new Error(out.stderr.toString());
  const pcm = out.stdout;
  const perWindow = Math.round(16000 * STEP);
  const db: number[] = [];
  for (let i = 0; i + perWindow * 4 <= pcm.length; i += perWindow * 4) {
    let sum = 0;
    for (let k = 0; k < perWindow; k++) { const value = pcm.readFloatLE(i + k * 4); sum += value * value; }
    db.push(10 * Math.log10(Math.max(1e-10, sum / perWindow)));
  }
  return db;
}

function main() {
  const [projectId, only] = process.argv.slice(2);
  if (!projectId) throw new Error("usage: caption-sync.ts <projectId> [sequenceId]");
  const edl = readEditor(projectId).edl;
  const shifts: number[] = [];

  for (const sequence of edl.sequences) {
    if (only && sequence.id !== only) continue;
    for (const item of sequence.items) {
      if (!item.mediaId || !item.clip.words.length) continue;
      const media = edl.media.find((m) => m.id === item.mediaId);
      if (!media) continue;
      const duration = item.clip.end - item.clip.start;
      const mask = speechMask(envelope(media.file, item.clip.start, duration));
      if (mask.length < 50) { console.log(`${sequence.id}: too little audio to measure`); continue; }
      const reading = readSync(item.clip.words, mask, STEP);
      shifts.push(reading.shiftSec);
      console.log(`${sequence.id} "${item.clip.title}" — ${item.clip.words.length} words over ${duration.toFixed(1)}s`);
      console.log(`  best shift ${(reading.shiftSec * 1000).toFixed(0)}ms at ${(reading.agreement * 100).toFixed(1)}%`
        + ` · where they are: ${(reading.unshifted * 100).toFixed(1)}%`);
      console.log(`  the sound calls ${(reading.speechShare * 100).toFixed(0)}% of it speech, the words claim ${(reading.wordShare * 100).toFixed(0)}%`);
    }
  }

  if (shifts.length > 1) {
    const mean = shifts.reduce((total, shift) => total + shift, 0) / shifts.length;
    console.log(`\nacross ${shifts.length} videos the shift averages ${(mean * 1000).toFixed(0)}ms`
      + `${Math.abs(mean) > 0.08 ? ` — consistent enough to put in captions.syncOffsetMs as ${Math.round(mean * 1000)}` : " — inside a frame, which is nothing to fix"}`);
  }
}

main();
