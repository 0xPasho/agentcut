import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { FFMPEG } from "../src/lib/bin";
import { sequenceFrames } from "../src/lib/sequences";

let workspace: string;
let database: typeof import("../src/lib/db");
before(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agentcut-sequence-render-"));
  process.env.AGENTCUT_WORKSPACE = workspace;
  database = await import("../src/lib/db");
});
after(async () => { database.db.close(); await fs.rm(workspace, { recursive: true, force: true }); });

/** One decoded pixel, averaged over the frame region the caller asks for. */
function pixel(file: string, sec: number, filter = "scale=1:1") {
  const seek = sec > 0 ? ["-ss", String(sec)] : [];
  const r = spawnSync(FFMPEG, ["-v", "error", ...seek, "-i", file, "-frames:v", "1", "-vf", filter, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
  assert.equal(r.status, 0, r.stderr.toString());
  return [...r.stdout];
}
const CENTRE = "crop=2:2:(iw-2)/2:(ih-2)/2,scale=1:1";

test("three-source exports preserve order, duration, audio, and UI/agent/CLI parity", { timeout: 180_000 }, async () => {
  const { createVideoProject } = await import("../src/lib/editor/media");
  const { readEditor, editProject } = await import("../src/lib/editor/store");
  const { executeEditorTool } = await import("../src/lib/editor/tools");
  const { renderProject } = await import("../src/lib/editor/render");
  const { probe } = await import("../src/lib/media");
  const inputs = [];
  for (const [index, color] of ["red", "green", "blue"].entries()) {
    const file = path.join(workspace, `${color}.mp4`);
    const r = spawnSync(FFMPEG, ["-y", "-f", "lavfi", "-i", `color=${color}:size=160x90:rate=10:duration=1`, "-f", "lavfi", "-i", `sine=frequency=${440+index*220}:duration=1`, "-shortest", "-pix_fmt", "yuv420p", "-c:a", "aac", file], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr); inputs.push({ file });
  }
  const { id } = await createVideoProject("RGB", inputs);
  const initial = readEditor(id), seq = initial.edl.sequences[0];
  editProject(id, { expectedRevision: initial.revision, operations: [{ type: "item.move", sequenceId: seq.id, itemId: seq.items[2].id, index: 0 }] });
  await executeEditorTool(id, { tool: "project.edit", expectedRevision: 2, operations: [{ type: "item.patch", sequenceId: seq.id, itemId: seq.items[1].id, patch: { end: 0.5 } }] });
  const state = readEditor(id);
  const captured = await executeEditorTool(id, { tool: "assets.capture", mediaId: seq.items[2].mediaId, atSec: 0.3 }) as { path: string };
  const capturePixel = pixel(path.join(workspace, captured.path), 0);
  assert.ok(capturePixel[2] > capturePixel[0]+80, "capture uses selected blue source, not primary red source");
  assert.equal(sequenceFrames(state.edl.sequences[0]).duration, 25);
  const output = await renderProject(id, { only: [seq.id], expectedRevision: state.revision });
  const file = output.outputs[0].file, meta = await probe(file);
  assert.equal(meta.hasAudio, true);
  assert.ok(Math.abs(meta.durationSec-2.5) < 0.15, `${meta.durationSec}`);
  const blue = pixel(file, 0.3), red = pixel(file, 1.3), green = pixel(file, 2.2);
  assert.ok(blue[2] > blue[0]+80); assert.ok(red[0] > red[1]+80); assert.ok(green[1] > green[2]+50);
  const hash = () => spawnSync(FFMPEG, ["-v", "error", "-i", file, "-f", "framemd5", "-"], { encoding: "utf8" }).stdout;
  const expected = hash();
  await executeEditorTool(id, { tool: "project.render", only: [seq.id], expectedRevision: state.revision });
  assert.equal(hash(), expected);
  const cli = spawnSync(process.execPath, [path.join(process.cwd(), "scripts/agentcut.mjs"), "render", id, "--only", seq.id], { cwd: os.tmpdir(), env: { ...process.env, AGENTCUT_WORKSPACE: workspace }, encoding: "utf8", timeout: 90_000 });
  assert.equal(cli.status, 0, cli.stderr); assert.equal(hash(), expected);
  editProject(id, { expectedRevision: state.revision, operations: [{ type: "sequence.add", sequence: { id: "empty", title: "Empty", output: seq.output, items: [] } }] });
  await assert.rejects(renderProject(id, { only: ["empty"] }), /Add a scene/);
});

test("a source-free canvas segment exports its title, image and music with no footage", { timeout: 180_000 }, async () => {
  const { createVideoProject } = await import("../src/lib/editor/media");
  const { readEditor, editProject } = await import("../src/lib/editor/store");
  const { executeEditorTool } = await import("../src/lib/editor/tools");
  const { renderProject } = await import("../src/lib/editor/render");
  const { assetEdit } = await import("../src/lib/editor/asset-edit");
  const { probe } = await import("../src/lib/media");
  const image = path.join(workspace, "blue.png"), tone = path.join(workspace, "tone.wav");
  for (const args of [["-f", "lavfi", "-i", "color=blue:size=320x180", "-frames:v", "1", image], ["-f", "lavfi", "-i", "sine=frequency=440:duration=2", tone]]) {
    const r = spawnSync(FFMPEG, ["-y", ...args], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
  }
  const { id } = await createVideoProject("Canvas only");
  const initial = readEditor(id);
  assert.equal(initial.edl.source, null, "the project never had a source video");
  const seq = initial.edl.sequences[0];
  const picture = await executeEditorTool(id, { tool: "assets.importLocal", file: image }) as { id: string };
  const music = await executeEditorTool(id, { tool: "assets.importLocal", file: tone }) as { id: string };
  const state = editProject(id, { expectedRevision: initial.revision, operations: [
    { type: "sequence.patch", sequenceId: seq.id, output: { width: 640, height: 360, fps: 10 } },
    { type: "item.add", sequenceId: seq.id, item: { id: "canvas", mediaId: null, clip: {
      id: "canvas", title: "Canvas", start: 0, end: 2, captions: { preset: "none" },
      edits: [
        { type: "text", t: 0, d: 0.8, text: "No footage", position: "center", style: "card" },
        assetEdit({ id: picture.id, kind: "image" }, 1, 2),
        assetEdit({ id: music.id, kind: "audio" }, 0, 2),
      ] } } },
  ] });
  assert.equal(sequenceFrames(state.edl.sequences[0]).duration, 20);
  const output = await renderProject(id, { only: [seq.id], expectedRevision: state.revision });
  const file = output.outputs[0].file, meta = await probe(file);
  assert.equal(meta.hasAudio, true, "the music bed survives without any source audio");
  assert.equal(meta.width, 640); assert.equal(meta.height, 360);
  assert.ok(Math.abs(meta.durationSec-2) < 0.15, `${meta.durationSec}`);
  const card = pixel(file, 0.4, CENTRE);
  assert.ok(card.every(c => c > 200), `the title card renders on the canvas: ${card}`);
  const picturePixel = pixel(file, 1.5, CENTRE);
  assert.ok(picturePixel[2] > picturePixel[0]+80, `the placed image renders on the canvas: ${picturePixel}`);
  const empty = pixel(file, 0.9, CENTRE);
  assert.ok(empty.every(c => c < 40), `the canvas itself is black, not footage: ${empty}`);
  // A shot whose media really is missing must fail loudly instead of exporting a canvas.
  editProject(id, { expectedRevision: state.revision, operations: [{ type: "sequence.add", sequence: { id: "broken", title: "Broken", output: seq.output,
    items: [{ id: "ghost", mediaId: null, clip: { id: "ghost", title: "Ghost", start: 0, end: 1 } }] } }] });
  const snapshot = readEditor(id);
  const broken = snapshot.edl.sequences.find(s => s.id === "broken")!;
  broken.items[0].mediaId = "gone";
  database.db.prepare("UPDATE projects SET edl = ? WHERE id = ?").run(JSON.stringify(snapshot.edl), id);
  await assert.rejects(renderProject(id, { only: ["broken"] }));
});
