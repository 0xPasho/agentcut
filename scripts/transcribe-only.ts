/** Extract audio + transcribe an existing project, then stop. */
import path from "node:path";
import fs from "node:fs/promises";
import { projectDir } from "../src/lib/config";
import { probe, extractAudio } from "../src/lib/media";
import { transcribe, DEFAULT_MODEL } from "../src/lib/transcribe/whispercpp";

async function main() {
  const id = process.argv[2];
  const dir = projectDir(id);
  const source = path.join(dir, "source.mp4");

  const meta = await probe(source);
  console.log(`source: ${meta.width}x${meta.height} ${Math.round(meta.durationSec)}s`);

  const wav = path.join(dir, "audio.wav");
  if (!(await fs.stat(wav).catch(() => null))) {
    console.log("extracting audio…");
    const t = Date.now();
    await extractAudio(source, wav);
    console.log(`audio done in ${((Date.now() - t) / 1000).toFixed(0)}s`);
  } else {
    console.log("audio.wav already present");
  }

  console.log(`transcribing with ${DEFAULT_MODEL}…`);
  const t = Date.now();
  const tr = await transcribe(wav, { outDir: dir });
  await fs.writeFile(path.join(dir, "transcript.json"), JSON.stringify(tr));
  console.log(
    `TRANSCRIBED in ${((Date.now() - t) / 60000).toFixed(1)}min — ` +
      `lang=${tr.language} ${tr.segments.length} segments ${tr.words.length} words`,
  );
  console.log("sample:", tr.segments.slice(0, 3).map((s) => s.text).join(" | "));
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
