import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { FFMPEG } from "../src/lib/bin";
import { Edl } from "../src/lib/edl";

let workspace: string;
let database: typeof import("../src/lib/db");
before(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agentcut-splice-"));
  process.env.AGENTCUT_WORKSPACE = workspace;
  database = await import("../src/lib/db");
});
after(async () => { database.db.close(); await fs.rm(workspace, { recursive: true, force: true }); });

function ffmpeg(args: string[]) {
  const result = spawnSync(FFMPEG, ["-v", "error", ...args], { maxBuffer: 64 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr.toString());
  return result.stdout;
}

/** Every frame of the render, as one RGB sample each. A splice that drops a frame shows up as black. */
function frameSamples(file: string) {
  const raw = ffmpeg(["-i", file, "-vf", "crop=2:2:0:0,scale=1:1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
  const frames: number[][] = [];
  for (let i = 0; i + 2 < raw.length; i += 3) frames.push([raw[i], raw[i + 1], raw[i + 2]]);
  return frames;
}

test("a silence cut splices without a black frame, and the clip plays to its last one", { timeout: 180_000 }, async () => {
  const source = path.join(workspace, "source.mp4");
  // 1.44s either side of the cut: each span rounds down to 14 frames on its own while
  // the pair rounds up to 29, so the frame nobody owned used to render black.
  ffmpeg(["-y", "-f", "lavfi", "-i", "color=red:size=320x180:rate=10:duration=5", "-f", "lavfi", "-i", "sine=frequency=440:duration=5", "-shortest", "-pix_fmt", "yuv420p", "-c:a", "aac", source]);

  const { publishClips } = await import("../src/lib/editor/store");
  const { renderProject } = await import("../src/lib/editor/render");
  const { q } = database;
  q.insertProject({ id: "splice", name: "splice", source_path: source, created_at: Date.now() });
  const saved = publishClips("splice", Edl.parse({
    projectId: "splice",
    source: { file: source, width: 320, height: 180, fps: 10, durationSec: 5 },
    output: { width: 180, height: 320, fps: 10 },
    clips: [{ id: "one", title: "Splice", start: 0, end: 3, captions: { preset: "none" }, edits: [{ type: "silence", t: 1.44, d: 0.12 }] }],
  }));

  const result = await renderProject("splice", { expectedRevision: saved.revision });
  const frames = frameSamples(result.outputs[0].file);
  assert.equal(frames.length, 29, `the clip is as long as the kept spans: ${frames.length}`);
  const black = frames.flatMap((rgb, i) => (rgb.every((v) => v < 24) ? [i] : []));
  assert.deepEqual(black, [], `no frame of a spliced clip is black: ${black}`);
});
