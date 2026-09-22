/**
 * Rebuild a project's EDL from the agent's clips.json.
 * For when the agent finished but the process awaiting it died.
 *   npx tsx scripts/finish.ts <projectId>
 */
import fs from "node:fs/promises";
import path from "node:path";
import { projectDir } from "../src/common/server/config";
import { publishClips } from "../src/modules/editor/server/store";
import { q } from "../src/common/server/db";
import { probe as probeFile } from "../src/modules/media/server/ffmpeg";
import { Transcript, fmt } from "../src/modules/transcription/lib/transcript";
import { buildEdl } from "../src/modules/clipping/server/select";

async function main() {
  const id = process.argv[2];
  if (!id) throw new Error("usage: tsx scripts/finish.ts <projectId>");

  const project = q.getProject(id);
  if (!project) throw new Error(`no project ${id}`);
  const dir = projectDir(id);

  const meta = project.probe ? JSON.parse(project.probe) : await probeFile(project.source_path);
  const transcript = Transcript.parse(
    JSON.parse(await fs.readFile(path.join(dir, "transcript.json"), "utf8")),
  );

  const edl = await buildEdl({
    projectId: id,
    videoPath: project.source_path,
    dir,
    probe: meta,
    transcript,
  });

  publishClips(id, edl);
  q.setProject(id, { status: "ready", error: null });
  console.log(`${edl.clips.length} clips`);
  for (const c of edl.clips) {
    console.log(`  ${String(c.score).padStart(3)}  ${fmt(c.start)}–${fmt(c.end)}  ${c.title}`);
  }
}

main().catch((e) => {
  console.error(`FAILED: ${e.message}`);
  process.exit(1);
});
