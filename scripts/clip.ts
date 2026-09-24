/**
 * End-to-end: video in -> EDL out.
 *   npx tsx scripts/clip.ts <video> [--clips 6] [--min 20] [--max 75] [--brief "..."] [--provider claude|codex]
 *
 * Or one long video out of a long recording, which is the same run asked a different
 * question — the template decides which:
 *   npx tsx scripts/clip.ts <video> --template stream-to-youtube [--minutes 90]
 */
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { ensureWorkspace, projectDir } from "../src/common/server/config";
import { publishClips } from "../src/modules/editor/server/store";
import { q } from "../src/common/server/db";
import { probe, extractAudio } from "../src/modules/media/server/ffmpeg";
import { transcribe, available as whisperAvailable, DEFAULT_MODEL } from "../src/modules/transcription/server/whispercpp";
import { computeSignals } from "../src/modules/clipping/server/signals";
import { selectClips } from "../src/modules/clipping/server/select";
import { resolveSelection } from "../src/modules/clipping/server/selection";
import { Transcript } from "../src/modules/transcription/lib/transcript";
import { fmt } from "../src/modules/transcription/lib/transcript";

function arg(name: string, fallback?: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : fallback;
}

const step = (s: string) => console.log(`\n\x1b[36m▸ ${s}\x1b[0m`);

async function main() {
  const input = process.argv[2];
  if (!input) throw new Error("usage: tsx scripts/clip.ts <video> [--clips N] [--brief '...']");
  const videoPath = path.resolve(input);
  await fs.access(videoPath);

  ensureWorkspace();
  const projectId = createHash("sha1").update(videoPath).digest("hex").slice(0, 10);
  const dir = projectDir(projectId);
  console.log(`project ${projectId} → ${dir}`);

  step("probe");
  const meta = await probe(videoPath);
  console.log(`  ${meta.width}x${meta.height} ${meta.fps.toFixed(2)}fps ${meta.durationSec.toFixed(1)}s audio=${meta.hasAudio}`);

  step("transcribe");
  const transcriptPath = path.join(dir, "transcript.json");
  let transcript: Transcript;
  const cached = await fs.readFile(transcriptPath, "utf8").catch(() => null);
  if (cached) {
    transcript = Transcript.parse(JSON.parse(cached));
    console.log(`  cached: ${transcript.segments.length} segments, ${transcript.words.length} words`);
  } else {
    if (!(await whisperAvailable())) throw new Error("whisper-cli not found — brew install whisper-cpp");
    const wav = await extractAudio(videoPath, path.join(dir, "audio.wav"));
    transcript = await transcribe(wav, { outDir: dir, model: arg("model", DEFAULT_MODEL) as never });
    console.log(`  ${transcript.segments.length} segments, ${transcript.words.length} words`);
  }

  step("signals");
  const signals = await computeSignals(videoPath, meta);
  console.log(`  ${signals.scenes.length} scene cuts, ${signals.peaks.length} loudness peaks`);

  const minutes = arg("minutes");
  const selection = await resolveSelection({
    templateId: arg("template"),
    selection: minutes ? { targetSec: Number(minutes) * 60 } : undefined,
    targetClipCount: process.argv.includes("--clips") ? Number(arg("clips")) : undefined,
    minSec: process.argv.includes("--min") ? Number(arg("min")) : undefined,
    maxSec: process.argv.includes("--max") ? Number(arg("max")) : undefined,
  });

  step(`agent: ${selection.summary}`);
  const edl = await selectClips({
    projectId,
    videoPath,
    dir,
    probe: meta,
    transcript,
    signals,
    selection: selection.spec,
    userBrief: arg("brief", "")!,
    provider: arg("provider"),
    onEvent: (e) => {
      if (e.kind === "tool") console.log(`  \x1b[90m[${e.name}] ${e.text}\x1b[0m`);
      if (e.kind === "error") console.log(`  \x1b[31m${e.text}\x1b[0m`);
    },
  });

  if (edl.sequences.length) {
    for (const sequence of edl.sequences) {
      const kept = sequence.items.reduce((total, item) => total + (item.clip.end - item.clip.start), 0);
      step(`${sequence.title} — ${Math.round(kept / 60)} min from ${sequence.items.length} stretches`);
      for (const item of sequence.items) console.log(`  ${fmt(item.clip.start)}–${fmt(item.clip.end)}  ${item.clip.title}`);
    }
  } else {
    step(`${edl.clips.length} clips`);
    for (const c of edl.clips) {
      console.log(`  \x1b[1m${String(c.score).padStart(3)}\x1b[0m  ${fmt(c.start)}–${fmt(c.end)}  ${c.title}`);
      if (c.reason) console.log(`       \x1b[90m${c.reason}\x1b[0m`);
    }
  }
  // Register it so the run shows up in the web UI, not just on disk.
  q.upsertProject({
    id: projectId,
    name: path.basename(videoPath),
    source_path: videoPath,
    status: "ready",
    probe: JSON.stringify(meta),
  });

  publishClips(projectId, edl);

  console.log(`\nEDL → ${path.join(dir, "edl.json")}`);
  console.log(`UI  → http://localhost:3000/p/${projectId}`);
}

main().catch((e) => {
  console.error(`\n\x1b[31mFAILED:\x1b[0m ${e.message}`);
  process.exit(1);
});
