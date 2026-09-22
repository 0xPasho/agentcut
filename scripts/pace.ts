/**
 * Measure how fast a finished video reads, and find the dead-air settings that would
 * reproduce it on new material.
 *
 *   tsx scripts/pace.ts <finished-video> [--against <raw-clip> ...]
 *
 * With one video it reports that video's pauses. With `--against`, it searches for the
 * `rhythm.silence` settings that make the raw material read like the finished one, which
 * is how a template's cuts are chosen by measurement rather than by taste.
 *
 * Both are transcribed with the recogniser this machine already uses; a transcript is
 * cached beside the file, so running it again is instant.
 */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { ensureTranscript } from "../src/modules/transcription/server/transcribe";
import { probe } from "../src/modules/media/server/ffmpeg";
import { gapProfile, fitSilence, NOTICEABLE_PAUSE, type GapProfile } from "../src/modules/templates/lib/pace";
import type { Word } from "../src/modules/transcription/lib/transcript";

async function wordsOf(file: string): Promise<{ words: Word[]; durationSec: number }> {
  const dir = path.join(os.tmpdir(), "agentcut-pace", createHash("sha1").update(path.resolve(file)).digest("hex").slice(0, 12));
  await fs.mkdir(dir, { recursive: true });
  const [{ transcript }, meta] = await Promise.all([
    ensureTranscript({ dir, sourcePath: path.resolve(file) }),
    probe(path.resolve(file)),
  ]);
  return { words: transcript.words.map((w) => ({ t: w.t, d: w.d, w: w.w })), durationSec: meta.durationSec };
}

const show = (label: string, p: GapProfile) =>
  console.log(`${label}\n  median ${p.median.toFixed(3)}s · p75 ${p.p75.toFixed(3)}s · p90 ${p.p90.toFixed(3)}s · p95 ${p.p95.toFixed(3)}s`
    + `\n  ${p.perMinute.toFixed(1)} pauses over ${NOTICEABLE_PAUSE}s per minute, across ${p.spanSec.toFixed(0)}s`);

async function main() {
  const args = process.argv.slice(2);
  const finished = args.find((a) => !a.startsWith("--"));
  if (!finished) throw new Error("usage: pace.ts <finished-video> [--against <raw-clip> ...]");
  const against: string[] = [];
  for (let i = 0; i < args.length; i++) if (args[i] === "--against" && args[i + 1]) against.push(args[i + 1]);

  const target = await wordsOf(finished);
  const profile = gapProfile(target.words);
  show(`${path.basename(finished)} — ${target.words.length} words`, profile);

  if (!against.length) {
    console.log("\nPass --against <raw clip> to get the rhythm.silence settings that would reproduce this pace.");
    return;
  }
  const material = await Promise.all(against.map(wordsOf));
  const fit = fitSilence(profile, material);
  console.log(`\n"rhythm": { "silence": { "minGapSec": ${fit.minGapSec}, "keepSec": ${fit.keepSec}, "maxGapSec": 30 } }`);
  show("which reads as", fit.profile);
  const raw = material.reduce((total, piece) => total + piece.durationSec, 0);
  console.log(`  and takes ${(100 - (fit.profile.spanSec / raw) * 100).toFixed(0)}% out of the material`
    + `\n\nThe fit matches the pauses, not the running time. Material with more dead air in it than the`
    + `\nfinished video had needs a shorter minGapSec than this, or it keeps every bit of thinking.`);
}

main().catch((error) => { console.error(error); process.exit(1); });
