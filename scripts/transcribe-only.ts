/**
 * Transcribe an existing project, then stop — the same recogniser, alignment and
 * proofread the analyze job runs, without selecting clips afterwards.
 *
 *   tsx scripts/transcribe-only.ts <projectId> [--resync]
 *
 * --resync also puts the new words back into every clip cut from the source,
 * exactly like the "Re-sync captions" button.
 */
import { q } from "../src/lib/db";
import { projectDir } from "../src/lib/config";
import { isUrl } from "../src/lib/ingest";
import { ensureTranscript } from "../src/lib/transcribe";
import { resyncTranscript } from "../src/lib/transcribe/resync";
import { DEFAULT_MODEL } from "../src/lib/transcribe/whispercpp";

async function main() {
  const [id, ...flags] = process.argv.slice(2);
  if (!id) throw new Error("usage: transcribe-only.ts <projectId> [--resync]");
  const project = q.getProject(id);
  if (!project) throw new Error(`project not found: ${id}`);
  if (!project.source_path || isUrl(project.source_path)) throw new Error("project has no downloaded source");

  console.log(`transcribing with ${DEFAULT_MODEL}…`);
  const t = Date.now();
  const log = (text: string) => console.log(`  ${text}`);
  const { transcript } = flags.includes("--resync")
    ? await resyncTranscript(id, { onLog: log })
    : await ensureTranscript({ dir: projectDir(id), sourcePath: project.source_path, force: true, onLog: log });

  console.log(
    `TRANSCRIBED in ${((Date.now() - t) / 60000).toFixed(1)}min — ` +
      `lang=${transcript.language} ${transcript.segments.length} segments ${transcript.words.length} words`,
  );
  console.log("sample:", transcript.segments.slice(0, 3).map((s) => s.text).join(" | "));
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
