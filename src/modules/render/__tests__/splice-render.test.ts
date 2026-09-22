import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { FFMPEG } from "../../../common/server/bin";
import { Edl } from "../../editor/types";

let workspace: string;
let database: typeof import("../../../common/server/db");
before(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agentcut-splice-"));
  process.env.AGENTCUT_WORKSPACE = workspace;
  database = await import("../../../common/server/db");
});
after(async () => { database.db.close(); await fs.rm(workspace, { recursive: true, force: true }); });

function ffmpeg(args: string[]) {
  const result = spawnSync(FFMPEG, ["-v", "error", ...args], { maxBuffer: 64 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr.toString());
  return result.stdout;
}

/** One RGB sample from a frame of the render. */
function pixel(file: string, sec: number, x: number, y: number) {
  return [...ffmpeg(["-ss", String(sec), "-i", file, "-frames:v", "1", "-vf", `crop=2:2:${x}:${y},scale=1:1`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"])];
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

  const { publishClips } = await import("../../editor/server/store");
  const { renderProject } = await import("../server/render-project");
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

test("a crop keyframe lands where the words it follows land, not where the uncut clock would put it", { timeout: 180_000 }, async () => {
  const source = path.join(workspace, "bands.mp4");
  // Three vertical bands: red, green, blue. Which one fills the frame says exactly
  // where the crop had got to.
  ffmpeg(["-y", "-f", "lavfi", "-i", "color=black:size=360x180:rate=10:duration=3",
    "-vf", "drawbox=x=0:y=0:w=120:h=180:color=red@1:t=fill,drawbox=x=120:y=0:w=120:h=180:color=green@1:t=fill,drawbox=x=240:y=0:w=120:h=180:color=blue@1:t=fill",
    "-pix_fmt", "yuv420p", source]);

  const { publishClips } = await import("../../editor/server/store");
  const { renderProject } = await import("../server/render-project");
  database.q.insertProject({ id: "crop", name: "crop", source_path: source, created_at: Date.now() });
  const saved = publishClips("crop", Edl.parse({
    projectId: "crop",
    source: { file: source, width: 360, height: 180, fps: 10, durationSec: 3 },
    output: { width: 120, height: 180, fps: 10 },
    clips: [{
      id: "one", title: "Crop", start: 0, end: 3, captions: { preset: "none" },
      // A second of the clip is cut away before the move finishes, so the keyframe at
      // source second 2 is reached at output second 1.
      edits: [{ type: "silence", t: 0.5, d: 1 }],
      crop: [{ t: 0, x: 0, y: 0, w: 120, h: 180 }, { t: 2, x: 240, y: 0, w: 120, h: 180 }],
    }],
  }));

  const result = await renderProject("crop", { expectedRevision: saved.revision });
  const file = result.outputs[0].file;
  const opening = pixel(file, 0.15, 10, 90);
  assert.ok(opening[0] > opening[1] + 60 && opening[0] > opening[2] + 60, `the clip opens on the first keyframe: ${opening}`);
  const arrived = pixel(file, 1.5, 10, 90);
  assert.ok(arrived[2] > arrived[1] + 60, `the crop has arrived, instead of still crossing the middle band: ${arrived}`);
});
