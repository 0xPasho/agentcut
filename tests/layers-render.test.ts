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
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agentcut-layers-render-"));
  process.env.AGENTCUT_WORKSPACE = workspace;
  database = await import("../src/lib/db");
});
after(async () => { database.db.close(); await fs.rm(workspace, { recursive: true, force: true }); });
function ffmpeg(args: string[]) {
  const result = spawnSync(FFMPEG, ["-v", "error", ...args]);
  assert.equal(result.status, 0, result.stderr.toString());
  return result.stdout;
}
function pixel(file: string, sec: number, x: number, y: number) {
  return [...ffmpeg(["-ss", String(sec), "-i", file, "-frames:v", "1", "-vf", `crop=2:2:${x}:${y},scale=1:1`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"])];
}
function rms(file: string, sec: number) {
  const samples = ffmpeg(["-ss", String(sec), "-i", file, "-t", "0.2", "-vn", "-ac", "1", "-f", "f32le", "-"]);
  let sum = 0;
  for (let i = 0; i < samples.length; i += 4) sum += samples.readFloatLE(i) ** 2;
  return Math.sqrt(sum / (samples.length / 4));
}

test("layered export composites PiP and transparent titles while music spans cuts and gaps", { timeout: 180_000 }, async () => {
  const { createVideoProject } = await import("../src/lib/editor/media");
  const { readEditor, editProject } = await import("../src/lib/editor/store");
  const { executeEditorTool } = await import("../src/lib/editor/tools");
  const { renderProject } = await import("../src/lib/editor/render");
  const inputs = [];
  for (const color of ["red", "green", "blue"]) {
    const file = path.join(workspace, `${color}.mp4`);
    ffmpeg(["-y", "-f", "lavfi", "-i", `color=${color}:size=640x360:rate=10:duration=2`, "-f", "lavfi", "-i", "sine=frequency=880:duration=2", "-shortest", "-pix_fmt", "yuv420p", "-c:a", "aac", file]);
    inputs.push({ file });
  }
  const tone = path.join(workspace, "music.wav");
  ffmpeg(["-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=5", tone]);
  const { id } = await createVideoProject("Layers", inputs);
  const initial = readEditor(id), seq = initial.edl.sequences[0];
  const music = await executeEditorTool(id, { tool: "assets.importLocal", file: tone }) as { id: string };
  const [red, green, blue] = seq.items;
  const state = editProject(id, { expectedRevision: initial.revision, operations: [
    { type: "sequence.remove", sequenceId: seq.id },
    { type: "sequence.add", sequence: { ...seq, output: { width: 640, height: 360, fps: 10 }, items: [
      { ...red, at: 0, muted: true }, { ...green, at: 2, muted: true },
      { ...blue, id: "rotated", at: 0, layer: 1, muted: true,
        clip: { ...blue.clip, id: "rotated", end: 1 },
        transform: { x: 20, y: 0, width: 10, height: 60, rotation: 90, opacity: 0.5 } },
      { ...blue, at: 1, layer: 1, muted: true, transform: { x: 50, y: 10, width: 40, height: 40, rotation: 0, opacity: 1 } },
      { id: "title", mediaId: null, at: 0, layer: 2, clip: { id: "title", title: "Title", start: 0, end: 5,
        captions: { preset: "none" }, edits: [{ type: "text", t: 0, d: 5, text: "TITLE", position: "bottom", style: "card" }] } },
      { id: "music", mediaId: null, at: 0, layer: 3, hidden: true, volume: 0.5, clip: { id: "music", title: "Music", start: 0, end: 5,
        captions: { preset: "none" }, edits: [
          { type: "text", t: 0, d: 5, text: "HIDDEN", position: "top", style: "card" },
          { type: "music", t: 0, d: 5, src: music.id, gain: 0.5, duck: false, loop: false },
        ] } },
    ] } },
  ] });
  assert.equal(sequenceFrames(state.edl.sequences[0]).duration, 50);
  const result = await renderProject(id, { only: [seq.id], expectedRevision: state.revision });
  const file = result.outputs[0].file;
  const redPixel = pixel(file, 0.5, 400, 80), bluePixel = pixel(file, 1.5, 400, 80);
  const pipOverGreen = pixel(file, 2.5, 400, 80), greenPixel = pixel(file, 3.5, 400, 80);
  assert.ok(redPixel[0] > redPixel[2] + 100, `${redPixel}`);
  const rotated = pixel(file, 0.5, 220, 108);
  assert.ok(rotated[0] > 90 && rotated[2] > 90 && rotated[1] < 30, `rotated nonuniform rectangle blends with base: ${rotated}`);
  const outsideRotation = pixel(file, 0.5, 160, 30);
  assert.ok(outsideRotation[0] > outsideRotation[2] + 100, "rotation uses the resized rectangle center");
  assert.ok(bluePixel[2] > bluePixel[0] + 100, `${bluePixel}`);
  assert.ok(pipOverGreen[2] > pipOverGreen[1] + 100, `${pipOverGreen}`);
  assert.ok(greenPixel[1] > greenPixel[2] + 70, `${greenPixel}`);
  assert.ok(pixel(file, 2.5, 30, 30)[1] > 70, "transparent title and music layers preserve background footage");
  assert.ok(pixel(file, 4.5, 30, 30).every(v => v < 15), "uncovered timeline gap is black");
  assert.ok(pixel(file, 4.5, 210, 220).every(v => v > 190), "title remains over the gap");
  const levels = [0.5, 1.5, 2.5, 3.5, 4.5].map(sec => rms(file, sec));
  assert.ok(levels.every(level => level > 0.015 && level < 0.03), `music gain multiplies item gain, source tracks muted: ${levels}`);
  assert.ok(Math.max(...levels) / Math.min(...levels) < 1.1, "music is uninterrupted across both cuts");
  const decodedHash = () => ffmpeg(["-i", file, "-f", "framemd5", "-"]).toString();
  const expected = decodedHash();
  await executeEditorTool(id, { tool: "project.render", only: [seq.id], expectedRevision: state.revision });
  assert.equal(decodedHash(), expected, "agent render matches UI render for layered edits");
  const cli = spawnSync(process.execPath, [path.join(process.cwd(), "scripts/agentcut.mjs"), "render", id, "--only", seq.id], {
    cwd: os.tmpdir(), env: { ...process.env, AGENTCUT_WORKSPACE: workspace }, encoding: "utf8", timeout: 90_000,
  });
  assert.equal(cli.status, 0, cli.stderr);
  assert.equal(decodedHash(), expected, "CLI render matches the same layered state");
});

test("split footage plays source audio once, hidden preserves audio, and mute silences all audio", { timeout: 180_000 }, async () => {
  const { createVideoProject } = await import("../src/lib/editor/media");
  const { readEditor, editProject } = await import("../src/lib/editor/store");
  const { renderProject } = await import("../src/lib/editor/render");
  const { probe } = await import("../src/lib/media");
  const { id } = await createVideoProject("Audio controls", [{ file: path.join(workspace, "red.mp4") }]);
  const initial = readEditor(id), seq = initial.edl.sequences[0], original = seq.items[0];
  const region = { x: 0, y: 0, w: 640, h: 360 };
  const split = { ...original, clip: { ...original.clip, layout: { type: "split" as const, topPct: 50, top: region, bottom: region } } };
  const state = editProject(id, { expectedRevision: initial.revision, operations: [
    { type: "sequence.add", sequence: { ...seq, id: "split", items: [split] } },
    { type: "sequence.add", sequence: { ...seq, id: "hidden", items: [{ ...original, hidden: true, volume: 0.5 }] } },
    { type: "sequence.add", sequence: { ...seq, id: "muted", items: [{ ...split, muted: true }] } },
  ] });
  const result = await renderProject(id, { expectedRevision: state.revision });
  const fileFor = (id: string) => result.outputs.find(out => out.clip.id === id)!.file;
  const baseLevel = rms(fileFor(seq.id), 0.5), splitLevel = rms(fileFor("split"), 0.5), hiddenLevel = rms(fileFor("hidden"), 0.5);
  assert.ok(Math.abs(splitLevel / baseLevel - 1) < 0.05, `split audio must not double: ${baseLevel}, ${splitLevel}`);
  assert.ok(Math.abs(hiddenLevel / baseLevel - 0.5) < 0.05, "hidden footage keeps audio with its gain");
  assert.ok(pixel(fileFor("hidden"), 0.5, 30, 30).every(v => v < 15));
  const mutedFile = fileFor("muted");
  if ((await probe(mutedFile)).hasAudio) assert.ok(rms(mutedFile, 0.5) < 0.0001);
});

test("promoting legacy clips preserves every decoded video frame and audio sample", { timeout: 180_000 }, async () => {
  const { Edl } = await import("../src/lib/edl");
  const { publishClips, editProject } = await import("../src/lib/editor/store");
  const { renderProject } = await import("../src/lib/editor/render");
  const source = path.join(workspace, "legacy-pattern.mp4");
  ffmpeg(["-y", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=10:duration=3", "-f", "lavfi", "-i", "sine=frequency=523:duration=3", "-shortest", "-pix_fmt", "yuv420p", "-c:a", "aac", source]);
  const id = "legacy-promotion";
  database.q.insertProject({ id, name: "Legacy promotion", source_path: source, created_at: Date.now() });
  const shared = {
    title: "Legacy edited clip", start: 0.2, end: 2.7,
    captions: { preset: "karaoke", positionY: 0.6, fontSizePct: 8, maxWordsPerLine: 2 },
    words: [{ t: 0.1, d: 0.4, w: "Same" }, { t: 0.5, d: 0.5, w: "editor" }, { t: 1.5, d: 0.5, w: "forever" }],
    edits: [
      { type: "silence", t: 1.1, d: 0.3 },
      { type: "punch", t: 0.2, d: 0.8, scale: 1.2 },
      { type: "emphasis", t: 0, d: 1, words: ["editor"], color: "#ff0000" },
      { type: "text", t: 1.5, d: 0.7, text: "Shared", position: "top", style: "plain" },
    ],
  };
  const initial = publishClips(id, Edl.parse({ projectId: id,
    source: { file: source, width: 320, height: 180, fps: 10, durationSec: 3 },
    output: { width: 180, height: 320, fps: 10 },
    clips: [
      { ...shared, id: "crop", crop: [{ t: 0, x: 0, y: 0, w: 160, h: 180 }, { t: 1.8, x: 160, y: 0, w: 160, h: 180 }] },
      { ...shared, id: "split", layout: { type: "split", topPct: 35, top: { x: 0, y: 0, w: 160, h: 180 }, bottom: { x: 160, y: 0, w: 160, h: 180 } } },
    ],
  }));
  const legacy = await renderProject(id, { expectedRevision: initial.revision });
  const hash = (file: string) => ffmpeg(["-i", file, "-f", "framemd5", "-"]).toString();
  const expected = new Map(legacy.outputs.map(output => [output.clip.id, hash(output.file)]));
  const promoted = editProject(id, { expectedRevision: initial.revision, operations: [
    { type: "clip.promote", clipId: "crop" }, { type: "clip.promote", clipId: "split" },
  ] });
  assert.equal(promoted.edl.clips.length, 0);
  assert.deepEqual(promoted.edl.sequences.map(sequence => sequence.id), ["crop", "split"]);
  const layered = await renderProject(id, { expectedRevision: promoted.revision });
  for (const output of layered.outputs) assert.equal(hash(output.file), expected.get(output.clip.id), `${output.clip.id}: promotion preserves video and source audio including captions, crop/split, punch and silence timing`);
});

test("a dip stays inside its own track: the joint darkens the footage, not the watermark above it", { timeout: 180_000 }, async () => {
  const { createVideoProject } = await import("../src/lib/editor/media");
  const { readEditor, editProject } = await import("../src/lib/editor/store");
  const { renderProject } = await import("../src/lib/editor/render");
  const inputs = [];
  for (const color of ["red", "blue", "green"]) {
    const file = path.join(workspace, `joint-${color}.mp4`);
    ffmpeg(["-y", "-f", "lavfi", "-i", `color=${color}:size=640x360:rate=10:duration=1`, "-pix_fmt", "yuv420p", file]);
    inputs.push({ file });
  }
  const { id } = await createVideoProject("A joint under a mark", inputs);
  const initial = readEditor(id), seq = initial.edl.sequences[0];
  const [red, blue, green] = seq.items;
  const state = editProject(id, { expectedRevision: initial.revision, operations: [
    { type: "sequence.remove", sequenceId: seq.id },
    { type: "sequence.add", sequence: { ...seq, output: { width: 640, height: 360, fps: 10 }, items: [
      { ...red, muted: true }, { ...blue, muted: true, transition: { kind: "dip", durationSec: 0.6, color: "#000000" } },
      // A corner mark held over both shots, on its own track.
      { ...green, id: "mark", at: 0, layer: 1, muted: true, clip: { ...green.clip, id: "mark" },
        transform: { x: 70, y: 70, width: 25, height: 25, rotation: 0, opacity: 1 } },
    ] } },
  ] });
  assert.equal(sequenceFrames(state.edl.sequences[0]).duration, 14, "the joint takes 0.6s out of two one-second shots");
  const file = (await renderProject(id, { only: [seq.id], expectedRevision: state.revision })).outputs[0].file;
  const beforeJoint = pixel(file, 0.15, 320, 180), inJoint = pixel(file, 0.75, 320, 180);
  assert.ok(beforeJoint[0] > beforeJoint[2] + 100, `the first shot before the joint: ${beforeJoint}`);
  assert.ok(inJoint.every(channel => channel < 60), `the footage dips to its colour: ${inJoint}`);
  const mark = pixel(file, 0.75, 480, 270);
  assert.ok(mark[1] > mark[0] + 80 && mark[1] > mark[2] + 80, `the mark on the track above holds straight through it: ${mark}`);
});
