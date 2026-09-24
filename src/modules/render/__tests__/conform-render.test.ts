import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { FFMPEG } from "../../../common/server/bin";
import { usedSpans } from "../server/conform";
import { VideoSequence } from "../../editor/types";

let workspace: string;
let database: typeof import("../../../common/server/db");
before(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agentcut-conform-"));
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
function pixel(file: string, sec: number) {
  return [...ffmpeg(["-ss", String(sec), "-i", file, "-frames:v", "1", "-vf", "crop=2:2:20:20,scale=1:1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"])];
}

const sequences = (items: unknown[]) =>
  [VideoSequence.parse({ id: "s", title: "S", output: { width: 320, height: 180, fps: 10 }, items })];

test("only the stretches a video plays are cut out of its source, merged where they nearly meet", () => {
  const item = (id: string, start: number, end: number) => ({ id, mediaId: "long", clip: { id, title: id, start, end } });
  // Two shots a second apart are one cut; a shot half a minute away is its own.
  const spans = usedSpans(sequences([item("a", 10, 12), item("b", 13, 15), item("c", 60, 62)]), "long", 600);
  assert.equal(spans.length, 2);
  assert.ok(spans[0].from < 10 && spans[0].to > 15, `${JSON.stringify(spans[0])}`);
  assert.ok(spans[1].from < 60 && spans[1].to > 62);
  // Nothing of a source this video never touches.
  assert.deepEqual(usedSpans(sequences([item("a", 10, 12)]), "other", 600), []);
  // The padding never reaches past either end of the recording.
  const edges = usedSpans(sequences([item("a", 0, 2)]), "long", 2);
  assert.deepEqual(edges, [{ from: 0, to: 2 }]);
});

test("a conformed render reads cuts of the source and exports exactly what the whole source would", { timeout: 300_000 }, async () => {
  const { createVideoProject } = await import("../../media/server/media-import");
  const { readEditor, editProject } = await import("../../editor/server/store");
  const { renderProject } = await import("../server/render-project");

  // Thirty seconds of distinct colour blocks: red for ten, green for ten, blue for ten.
  // A shot taken from the green stretch has to come out green whichever path it took.
  const source = path.join(workspace, "long.mp4");
  ffmpeg(["-y",
    "-f", "lavfi", "-i", "color=red:size=320x180:rate=10:duration=10",
    "-f", "lavfi", "-i", "color=green:size=320x180:rate=10:duration=10",
    "-f", "lavfi", "-i", "color=blue:size=320x180:rate=10:duration=10",
    "-filter_complex", "[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]", "-map", "[v]",
    "-pix_fmt", "yuv420p", "-g", "50", source]);

  const { id } = await createVideoProject("Conform", [{ file: source }]);
  const initial = readEditor(id), seq = initial.edl.sequences[0], shot = seq.items[0];
  // One shot out of the green stretch and one out of the blue: two thirds of the source
  // is never played, which is the whole reason for cutting it up.
  const state = editProject(id, { expectedRevision: initial.revision, operations: [
    { type: "sequence.remove", sequenceId: seq.id },
    { type: "sequence.add", sequence: { ...seq, output: { width: 320, height: 180, fps: 10 }, items: [
      { ...shot, id: "green", at: 0, muted: true, clip: { ...shot.clip, id: "green", start: 12, end: 13 } },
      { ...shot, id: "blue", at: 1, muted: true, clip: { ...shot.clip, id: "blue", start: 25, end: 26 } },
    ] } },
  ] });

  // The same revision twice: once reading the source itself, once reading cuts of it.
  const whole = await renderProject(id, { only: [seq.id], expectedRevision: state.revision });
  const wholeFile = path.join(workspace, "whole.mp4");
  await fs.copyFile(whole.outputs[0].file, wholeFile);

  const conformed = await renderProject(id, { only: [seq.id], expectedRevision: state.revision, conformMinBytes: 1 });
  const cuts = await fs.readdir(path.join(path.dirname(path.dirname(conformed.outputs[0].file)), "conform")).catch(() => [] as string[]);
  assert.equal(cuts.length, 2, `one cut per stretch played, not one per source: ${cuts.join(", ")}`);

  for (const at of [0.5, 1.5]) {
    const before = pixel(wholeFile, at), after = pixel(conformed.outputs[0].file, at);
    for (const channel of [0, 1, 2]) assert.ok(Math.abs(before[channel] - after[channel]) <= 12, `${at}s: ${before} vs ${after}`);
  }
  // And what it shows is the footage those times actually name.
  const green = pixel(conformed.outputs[0].file, 0.5), blue = pixel(conformed.outputs[0].file, 1.5);
  assert.ok(green[1] > green[0] + 40 && green[1] > green[2] + 40, `green shot: ${green}`);
  assert.ok(blue[2] > blue[0] + 40 && blue[2] > blue[1] + 40, `blue shot: ${blue}`);
});
