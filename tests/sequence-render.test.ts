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

test("a picture that fills its scene is there on the scene's first frame", { timeout: 180_000 }, async () => {
  const { createVideoProject } = await import("../src/lib/editor/media");
  const { readEditor, editProject } = await import("../src/lib/editor/store");
  const { executeEditorTool } = await import("../src/lib/editor/tools");
  const { renderProject } = await import("../src/lib/editor/render");
  const { assetEdit } = await import("../src/lib/editor/asset-edit");
  const image = path.join(workspace, "picture.png");
  const made = spawnSync(FFMPEG, ["-y", "-f", "lavfi", "-i", "color=blue:size=320x180", "-frames:v", "1", image], { encoding: "utf8" });
  assert.equal(made.status, 0, made.stderr);
  const { id } = await createVideoProject("Picture scene");
  const initial = readEditor(id), seq = initial.edl.sequences[0];
  const picture = await executeEditorTool(id, { tool: "assets.importLocal", file: image }) as { id: string };
  // Exactly what the Image button places: a scene as long as the picture, and the picture on it.
  const state = editProject(id, { expectedRevision: initial.revision, operations: [
    { type: "sequence.patch", sequenceId: seq.id, output: { width: 640, height: 360, fps: 10 } },
    { type: "item.add", sequenceId: seq.id, item: { id: "picture", mediaId: null, at: 0, clip: {
      id: "picture", title: "Image", start: 0, end: 2, captions: { preset: "none" },
      edits: [assetEdit({ id: picture.id, kind: "image" }, 0, 2)] } } },
  ] });
  const output = await renderProject(id, { only: [seq.id], expectedRevision: state.revision });
  // The frame the playhead lands on when the picture is added: a fade from nothing here
  // leaves an author looking at the selection box around an empty canvas.
  const first = pixel(output.outputs[0].file, 0, CENTRE);
  assert.ok(first[2] > first[0] + 80, `the picture is on its own first frame: ${first}`);
  const last = pixel(output.outputs[0].file, 1.9, CENTRE);
  assert.ok(last[2] > last[0] + 80, `and on its last: ${last}`);
});

test("separated audio still sounds, and the picture it came from does not show", { timeout: 180_000 }, async () => {
  const { createVideoProject } = await import("../src/lib/editor/media");
  const { readEditor, editProject } = await import("../src/lib/editor/store");
  const { renderProject } = await import("../src/lib/editor/render");
  const { probe } = await import("../src/lib/media");

  // One second of red with a tone under it: the picture and the sound are both checkable.
  const talking = path.join(workspace, "talking.mp4");
  const made = spawnSync(FFMPEG, ["-y", "-f", "lavfi", "-i", "color=red:size=160x90:rate=10:duration=1",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-shortest", "-pix_fmt", "yuv420p", "-c:a", "aac", talking], { encoding: "utf8" });
  assert.equal(made.status, 0, made.stderr);

  const { id } = await createVideoProject("Detached", [{ file: talking }]);
  const initial = readEditor(id);
  const sequence = initial.edl.sequences[0];
  const state = editProject(id, { expectedRevision: initial.revision, operations: [
    { type: "item.detachAudio", sequenceId: sequence.id, itemId: sequence.items[0].id, newItemId: "sound" },
    // With the picture hidden as well, what is left on screen is the empty canvas — and
    // whatever comes out of the speakers came from the separated track.
    { type: "item.place", sequenceId: sequence.id, itemId: sequence.items[0].id, patch: { hidden: true } },
  ] });
  assert.equal(sequenceFrames(state.edl.sequences[0]).duration, 10, "separating audio does not change the length");

  const output = await renderProject(id, { only: [sequence.id], expectedRevision: state.revision });
  const meta = await probe(output.outputs[0].file);
  assert.equal(meta.hasAudio, true, "the separated track is still in the export");
  // An audio stream is not a sound: a silent track would pass that and fail the ear.
  const levels = spawnSync(FFMPEG, ["-v", "info", "-i", output.outputs[0].file, "-af", "volumedetect", "-f", "null", "-"], { encoding: "utf8" });
  const mean = Number(levels.stderr.match(/mean_volume: (-?[\d.]+) dB/)?.[1] ?? -100);
  assert.ok(mean > -40, `the separated audio is audible, mean volume ${mean} dB`);
  const frame = pixel(output.outputs[0].file, 0.5, CENTRE);
  assert.ok(frame[0] < 60, `the hidden picture is not on screen, got rgb(${frame.join(",")})`);
});

/** RMS of a window of the exported audio, decoded to mono floats. */
function loudness(file: string, sec: number, span: number) {
  const result = spawnSync(FFMPEG, ["-v", "error", "-ss", String(sec), "-i", file, "-t", String(span), "-vn", "-ac", "1", "-f", "f32le", "-"]);
  assert.equal(result.status, 0, result.stderr.toString());
  let sum = 0;
  for (let i = 0; i < result.stdout.length; i += 4) sum += result.stdout.readFloatLE(i) ** 2;
  return Math.sqrt(sum / Math.max(1, result.stdout.length / 4));
}

test("a transition blends real pixels, dips through its colour, ramps the sound, and exports the same from every entry point", { timeout: 240_000 }, async () => {
  const { createVideoProject } = await import("../src/lib/editor/media");
  const { readEditor, editProject } = await import("../src/lib/editor/store");
  const { executeEditorTool } = await import("../src/lib/editor/tools");
  const { renderProject } = await import("../src/lib/editor/render");
  const { probe } = await import("../src/lib/media");
  const inputs = [];
  // The first shot sounds and the second is silent, so the ramp across the joint is
  // measurable: without one, the first shot would play at full volume under the second.
  for (const [index, color] of ["red", "blue"].entries()) {
    const file = path.join(workspace, `joint-${color}.mp4`);
    const audio = index === 0 ? "sine=frequency=440:duration=1" : "anullsrc=r=44100:cl=mono:duration=1";
    const r = spawnSync(FFMPEG, ["-y", "-f", "lavfi", "-i", `color=${color}:size=160x90:rate=10:duration=1`, "-f", "lavfi", "-i", audio, "-shortest", "-pix_fmt", "yuv420p", "-c:a", "aac", file], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr); inputs.push({ file });
  }
  const { id } = await createVideoProject("A joint", inputs);
  const initial = readEditor(id), seq = initial.edl.sequences[0];
  assert.equal(sequenceFrames(seq).duration, 20, "two one-second shots meeting on a hard cut");
  const joint = { type: "item.transition", sequenceId: seq.id, itemId: seq.items[1].id, transition: { kind: "dissolve", durationSec: 0.6 } };
  const state = editProject(id, { expectedRevision: initial.revision, operations: [joint] });
  assert.equal(sequenceFrames(state.edl.sequences[0]).duration, 14, "the overlap comes out of the programme");
  const output = await renderProject(id, { only: [seq.id], expectedRevision: state.revision });
  const file = output.outputs[0].file, meta = await probe(file);
  assert.ok(Math.abs(meta.durationSec - 1.4) < 0.15, `${meta.durationSec}`);
  const before = pixel(file, 0.15, CENTRE), middle = pixel(file, 0.75, CENTRE), after = pixel(file, 1.25, CENTRE);
  assert.ok(before[0] > before[2] + 80, `the first shot is still itself before the joint: ${before}`);
  assert.ok(after[2] > after[0] + 80, `the second shot arrives whole after it: ${after}`);
  assert.ok(middle[0] > 50 && middle[2] > 50, `inside the joint both shots are on screen at once: ${middle}`);
  assert.ok(middle[0] < before[0] - 40 && middle[2] < after[2] - 40, `and neither of them has won it yet: ${middle}`);
  const loud = loudness(file, 0.4, 0.15), quiet = loudness(file, 0.85, 0.15);
  assert.ok(loud > 0.02, `the first shot still sounds as the joint opens: ${loud}`);
  assert.ok(quiet < loud * 0.5, `and is ramped down by the end of it rather than playing under the next shot: ${quiet} vs ${loud}`);
  // The same revision, through the agent's own render tool and the CLI.
  const hash = () => spawnSync(FFMPEG, ["-v", "error", "-i", file, "-f", "framemd5", "-"], { encoding: "utf8" }).stdout;
  const expected = hash();
  await executeEditorTool(id, { tool: "project.render", only: [seq.id], expectedRevision: state.revision });
  assert.equal(hash(), expected, "the agent's export of this revision is the same video");
  const cli = spawnSync(process.execPath, [path.join(process.cwd(), "scripts/agentcut.mjs"), "render", id, "--only", seq.id], { cwd: os.tmpdir(), env: { ...process.env, AGENTCUT_WORKSPACE: workspace }, encoding: "utf8", timeout: 120_000 });
  assert.equal(cli.status, 0, cli.stderr);
  assert.equal(hash(), expected, "and so is the command line's");
  // A dip holds its colour over the cut it is hiding, which is the whole point of one.
  const dipped = await executeEditorTool(id, { tool: "project.edit", expectedRevision: state.revision, operations: [
    { ...joint, transition: { kind: "dip", durationSec: 0.6, color: "#ffffff" }, before: state.edl.sequences[0].items[1].transition },
  ] }) as typeof state;
  const dipFile = (await renderProject(id, { only: [seq.id], expectedRevision: dipped.revision })).outputs[0].file;
  const held = pixel(dipFile, 0.75, CENTRE);
  assert.ok(held.every(channel => channel > 200), `the dip is at its colour over the cut: ${held}`);
  assert.ok(pixel(dipFile, 0.15, CENTRE)[0] > 150, "and the shots either side are untouched by it");
  assert.ok(pixel(dipFile, 1.25, CENTRE)[2] > 150);
});

test("a shot that arrives on a blend starts its own move at the first frame of the overlap", { timeout: 300_000 }, async () => {
  const { createVideoProject } = await import("../src/lib/editor/media");
  const { readEditor, editProject } = await import("../src/lib/editor/store");
  const { renderProject } = await import("../src/lib/editor/render");
  const inputs = [];
  for (const colour of ["green", "blue"]) {
    const file = path.join(workspace, `joint-move-${colour}.mp4`);
    const made = spawnSync(FFMPEG, ["-y", "-v", "error", "-f", "lavfi", "-i", `color=${colour}:size=640x360:rate=10:duration=1`, "-pix_fmt", "yuv420p", file], { encoding: "utf8" });
    assert.equal(made.status, 0, made.stderr);
    inputs.push({ file });
  }
  const { id } = await createVideoProject("A move inside a joint", inputs);
  const initial = readEditor(id), seq = initial.edl.sequences[0];
  const [first, second] = seq.items;
  const state = editProject(id, { expectedRevision: initial.revision, operations: [
    { type: "sequence.remove", sequenceId: seq.id },
    { type: "sequence.add", sequence: { ...seq, output: { width: 640, height: 360, fps: 10 }, items: [
      { ...first, muted: true },
      { ...second, muted: true, transition: { kind: "dissolve", durationSec: 0.6 },
        transform: { x: 0, y: 0, width: 50, height: 50, rotation: 0, opacity: 1 },
        keyframes: [{ t: 0, x: 0 }, { t: 1, x: 50 }] },
    ] } },
  ] });
  const resolved = sequenceFrames(state.edl.sequences[0]);
  assert.equal(resolved.duration, 14, "the joint still takes 0.6s out of two one-second shots");
  assert.equal(resolved.items[1].from, 4, "and the incoming shot's own time zero is the first frame of the overlap");
  const file = (await renderProject(id, { only: [seq.id], expectedRevision: state.revision })).outputs[0].file;

  // Inside the joint the incoming shot is faint, so where it is reads as a difference
  // between two places rather than as an absolute colour. Early in the overlap the blend
  // is on the left; late in it, it has already travelled right — which is the documented
  // behaviour: the move begins as the shot begins to appear, not after the blend ends.
  const earlyLeft = pixel(file, 0.5, "crop=2:2:60:90,scale=1:1"), earlyRight = pixel(file, 0.5, "crop=2:2:450:90,scale=1:1");
  assert.ok(earlyLeft[2] > earlyRight[2] + 15, `0.1s into the joint the moving layer is on the left: ${earlyLeft} vs ${earlyRight}`);
  const lateLeft = pixel(file, 0.95, "crop=2:2:60:90,scale=1:1"), lateRight = pixel(file, 0.95, "crop=2:2:450:90,scale=1:1");
  assert.ok(lateRight[2] > lateLeft[2] + 15, `by the end of the joint it has travelled right: ${lateLeft} vs ${lateRight}`);
  // Past the joint it keeps going on the same clock, with nothing under it any more.
  const after = pixel(file, 1.25, "crop=2:2:500:90,scale=1:1"), vacated = pixel(file, 1.25, "crop=2:2:60:90,scale=1:1");
  assert.ok(after[2] > after[0] + 80, `after the joint the layer is whole and further right: ${after}`);
  assert.ok(vacated.every(channel => channel < 60), `and where it started is the empty frame: ${vacated}`);
});
