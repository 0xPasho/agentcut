/**
 * End-to-end: video in -> EDL out.
 *   npx tsx scripts/clip.ts <video> [--clips 6] [--min 20] [--max 75] [--brief "..."] [--provider claude|codex]
 */
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { ensureWorkspace, projectDir } from "../src/lib/config";
import { publishClips } from "../src/lib/editor/store";
import { q } from "../src/lib/db";
import { probe, extractAudio } from "../src/lib/media";
import { transcribe, available as whisperAvailable, DEFAULT_MODEL } from "../src/lib/transcribe/whispercpp";
import { computeSignals } from "../src/lib/pipeline/signals";
import { selectClips } from "../src/lib/pipeline/select";
import { Transcript } from "../src/lib/transcript";
import { fmt } from "../src/lib/transcript";

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

  step("agent: selecting clips");
  const edl = await selectClips({
    projectId,
    videoPath,
    dir,
    probe: meta,
    transcript,
    signals,
    targetClipCount: Number(arg("clips", "6")),
    minSec: Number(arg("min", "20")),
    maxSec: Number(arg("max", "75")),
    userBrief: arg("brief", "")!,
    provider: arg("provider"),
    onEvent: (e) => {
      if (e.kind === "tool") console.log(`  \x1b[90m[${e.name}] ${e.text}\x1b[0m`);
      if (e.kind === "error") console.log(`  \x1b[31m${e.text}\x1b[0m`);
    },
  });

  step(`${edl.clips.length} clips`);
  for (const c of edl.clips) {
    console.log(`  \x1b[1m${String(c.score).padStart(3)}\x1b[0m  ${fmt(c.start)}–${fmt(c.end)}  ${c.title}`);
    if (c.reason) console.log(`       \x1b[90m${c.reason}\x1b[0m`);
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
