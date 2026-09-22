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

/**
 * How many pixels along one row of the frame lean blue — the width of a blue block on it.
 *
 * Two rows are cropped rather than one because a 4:2:0 frame has no odd heights; the
 * first row of the decoded pair is the scanline.
 */
function blueRun(file: string, sec: number, y: number, width: number) {
  const rows = ffmpeg(["-ss", String(sec), "-i", file, "-frames:v", "1", "-vf", `crop=${width}:2:0:${y}`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
  let n = 0;
  for (let i = 0; i < width * 3; i += 3) if (rows[i + 2] > rows[i] + 60 && rows[i + 2] > rows[i + 1] + 60) n += 1;
  return n;
}

test("a keyframed layer travels, grows and fades in decoded pixels, ducks its own sound, and exports the same from every entry point", { timeout: 300_000 }, async () => {
  const { createVideoProject } = await import("../src/lib/editor/media");
  const { readEditor, editProject } = await import("../src/lib/editor/store");
  const { executeEditorTool } = await import("../src/lib/editor/tools");
  const { renderProject } = await import("../src/lib/editor/render");
  const inputs = [];
  for (const colour of ["green", "blue", "red"]) {
    const file = path.join(workspace, `move-${colour}.mp4`);
    ffmpeg(["-y", "-f", "lavfi", "-i", `color=${colour}:size=640x360:rate=10:duration=2`, "-pix_fmt", "yuv420p", file]);
    inputs.push({ file });
  }
  const bed = path.join(workspace, "bed.wav");
  ffmpeg(["-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", bed]);
  const { id } = await createVideoProject("Moves", inputs);
  const initial = readEditor(id), seq = initial.edl.sequences[0];
  const music = await executeEditorTool(id, { tool: "assets.importLocal", file: bed }) as { id: string };
  const [background, slider, fader] = seq.items;
  const state = editProject(id, { expectedRevision: initial.revision, operations: [
    { type: "sequence.remove", sequenceId: seq.id },
    { type: "sequence.add", sequence: { ...seq, output: { width: 640, height: 360, fps: 10 }, items: [
      { ...background, at: 0, muted: true },
      // Across the top strip: starts narrow on the left, ends wide on the right.
      { ...slider, id: "slider", at: 0, layer: 1, muted: true, clip: { ...slider.clip, id: "slider" },
        transform: { x: 0, y: 0, width: 10, height: 20, rotation: 0, opacity: 1 },
        keyframes: [{ t: 0, x: 0, width: 10 }, { t: 2, x: 60, width: 40 }] },
      // Low and to the middle, holding still: only its opacity is animated.
      { ...fader, id: "fader", at: 0, layer: 2, muted: true, clip: { ...fader.clip, id: "fader" },
        transform: { x: 40, y: 70, width: 20, height: 25, rotation: 0, opacity: 0 },
        keyframes: [{ t: 0, opacity: 0 }, { t: 2, opacity: 1 }] },
      // A bed that dips under the middle of the video and comes back: the gain a person
      // draws by hand, multiplying the music edit's own automatic ducking rather than
      // replacing it (`src/lib/ducking.ts`, switched off here so this measures one thing).
      { id: "bed", mediaId: null, at: 0, layer: 3, hidden: true,
        keyframes: [{ t: 0, volume: 0.9 }, { t: 0.6, volume: 0.05 }, { t: 1.4, volume: 0.05 }, { t: 2, volume: 0.9 }],
        clip: { id: "bed", title: "Bed", start: 0, end: 2, captions: { preset: "none" },
          edits: [{ type: "music", t: 0, d: 2, src: music.id, gain: 0.6, duck: false, loop: false }] } },
    ] } },
  ] });
  assert.equal(sequenceFrames(state.edl.sequences[0]).duration, 20, "animating a layer changes nothing about the timing");
  const file = (await renderProject(id, { only: [seq.id], expectedRevision: state.revision })).outputs[0].file;

  // It travelled: the block is on the left at the start and on the right at the end.
  const leftEarly = pixel(file, 0, 30, 30), rightEarly = pixel(file, 0, 500, 30);
  const leftLate = pixel(file, 1.9, 30, 30), rightLate = pixel(file, 1.9, 500, 30);
  assert.ok(leftEarly[2] > leftEarly[1] + 60, `the layer starts on the left: ${leftEarly}`);
  assert.ok(rightEarly[1] > rightEarly[2] + 40, `and is not yet on the right: ${rightEarly}`);
  assert.ok(rightLate[2] > rightLate[1] + 60, `by the end it is on the right: ${rightLate}`);
  assert.ok(leftLate[1] > leftLate[2] + 40, `and has left where it started: ${leftLate}`);
  // It grew: the same block is wider every time it is measured.
  const widths = [0, 1, 1.9].map(sec => blueRun(file, sec, 30, 640));
  assert.ok(widths[0] > 40 && widths[0] < 95, `10% of 640 at the first frame: ${widths}`);
  assert.ok(widths[1] > 130 && widths[1] < 195, `25% of 640 halfway: ${widths}`);
  assert.ok(widths[2] > 205 && widths[2] < 285, `38.5% of 640 near the end: ${widths}`);
  // It faded: the same spot goes from the footage underneath to the layer above it.
  const fade = [0, 1, 1.9].map(sec => pixel(file, sec, 320, 300));
  assert.ok(fade[0][1] > fade[0][0] + 80, `at the start the layer is invisible: ${fade[0]}`);
  assert.ok(fade[1][0] > fade[0][0] + 60 && fade[1][1] > fade[2][1] + 40, `halfway it is half there: ${fade[1]}`);
  assert.ok(fade[2][0] > fade[2][1] + 150, `by the end it has covered what was under it: ${fade[2]}`);
  // It ducked: the bed is loud, dips through the middle, and comes back.
  const levels = [0.15, 1.0, 1.8].map(sec => rms(file, sec));
  assert.ok(levels[0] > levels[1] * 4, `the bed dips under the middle of the video: ${levels}`);
  assert.ok(levels[2] > levels[1] * 4, `and comes back up after it: ${levels}`);
  // The same revision, through the agent's own render tool and through the command line.
  const decodedHash = () => ffmpeg(["-i", file, "-f", "framemd5", "-"]).toString();
  const expected = decodedHash();
  await executeEditorTool(id, { tool: "project.render", only: [seq.id], expectedRevision: state.revision });
  assert.equal(decodedHash(), expected, "the agent's export of this revision is the same video");
  const cli = spawnSync(process.execPath, [path.join(process.cwd(), "scripts/agentcut.mjs"), "render", id, "--only", seq.id], {
    cwd: os.tmpdir(), env: { ...process.env, AGENTCUT_WORKSPACE: workspace }, encoding: "utf8", timeout: 120_000,
  });
  assert.equal(cli.status, 0, cli.stderr);
  assert.equal(decodedHash(), expected, "and so is the command line's");
});

/** A whole decoded frame, as flat rgb triples. */
const frameAt = (file: string, sec: number) =>
  ffmpeg(["-ss", String(sec), "-i", file, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);

/** How far apart two decoded frames are, averaged over every channel of every pixel. */
function difference(a: Buffer, b: Buffer) {
  assert.equal(a.length, b.length, "frames of the same size");
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
}

/**
 * Where the blue layer is and how much of it there is, weighed out of a decoded frame.
 *
 * Comparing two encodings pixel for pixel would be comparing the encoder: cutting a shot
 * in two changes where its key frames land, and h264 re-quantises around that. Position
 * and area survive that, and they are what a split must not move.
 */
function blueMass(buf: Buffer, width: number) {
  let weight = 0, x = 0;
  for (let i = 0; i < buf.length; i += 3) {
    const blueness = Math.max(0, buf[i + 2] - Math.max(buf[i], buf[i + 1]));
    weight += blueness;
    x += blueness * ((i / 3) % width);
  }
  return { weight: weight / (buf.length / 3), centre: weight ? x / weight : -1 };
}

test("splitting a moving layer is invisible: the same seconds decode to the same picture", { timeout: 300_000 }, async () => {
  const { createVideoProject } = await import("../src/lib/editor/media");
  const { readEditor, editProject } = await import("../src/lib/editor/store");
  const { renderProject } = await import("../src/lib/editor/render");
  const inputs = [];
  for (const colour of ["green", "blue"]) {
    const file = path.join(workspace, `split-move-${colour}.mp4`);
    ffmpeg(["-y", "-f", "lavfi", "-i", `color=${colour}:size=640x360:rate=10:duration=3`, "-pix_fmt", "yuv420p", file]);
    inputs.push({ file });
  }
  const { id } = await createVideoProject("A move cut in two", inputs);
  const initial = readEditor(id), seq = initial.edl.sequences[0];
  const [bed, mover] = seq.items;
  const whole = editProject(id, { expectedRevision: initial.revision, operations: [
    { type: "sequence.remove", sequenceId: seq.id },
    { type: "sequence.add", sequence: { ...seq, output: { width: 640, height: 360, fps: 10 }, items: [
      { ...bed, at: 0, muted: true },
      { ...mover, id: "mover", at: 0, layer: 1, muted: true, clip: { ...mover.clip, id: "mover" },
        transform: { x: 0, y: 40, width: 20, height: 20, rotation: 0, opacity: 1 },
        // `linear`, which is what every move this editor writes by hand starts as, and the
        // only kind a split can reproduce exactly — see the curve note below.
        keyframes: [{ t: 0, x: 0, opacity: 0.4 }, { t: 3, x: 70, opacity: 1 }] },
    ] } },
  ] });
  const before = (await renderProject(id, { only: [seq.id], expectedRevision: whole.revision })).outputs[0].file;
  const moments = [0.2, 0.7, 1.4, 1.6, 2.2, 2.8];
  const original = moments.map(sec => frameAt(before, sec));

  const cut = editProject(id, { expectedRevision: whole.revision, operations: [
    { type: "item.split", sequenceId: seq.id, itemId: "mover", at: 1.5, newItemId: "tail" },
  ] });
  const halves = cut.edl.sequences[0].items.filter(item => item.id === "mover" || item.id === "tail");
  assert.equal(halves.length, 2, "the layer really was cut in two");
  assert.deepEqual(halves.map(half => half.keyframes!.length), [2, 2], "and each half carries its share of the move");
  assert.equal(sequenceFrames(cut.edl.sequences[0]).duration, 30, "cutting it changes nothing about the timing");

  const after = (await renderProject(id, { only: [seq.id], expectedRevision: cut.revision })).outputs[0].file;
  const cutFrames = moments.map(sec => frameAt(after, sec));
  const was = original.map(frame => blueMass(frame, 640)), now = cutFrames.map(frame => blueMass(frame, 640));
  for (const [index, sec] of moments.entries()) {
    assert.ok(Math.abs(was[index].centre - now[index].centre) < 2,
      `at ${sec}s the layer is where it was before the cut: ${was[index].centre.toFixed(1)} vs ${now[index].centre.toFixed(1)}`);
    assert.ok(Math.abs(was[index].weight - now[index].weight) < 1.5,
      `and as much of it is there: ${was[index].weight.toFixed(1)} vs ${now[index].weight.toFixed(1)}`);
    assert.ok(difference(original[index], cutFrames[index]) < 6,
      `and the frame as a whole only differs by what the encoder did: ${difference(original[index], cutFrames[index]).toFixed(2)}`);
  }
  // A curved ease is the stated limit, not a second bug: the catalogue has no curve that
  // is "the first 40% of an ease", so each half re-eases the travel it still has. The seam
  // itself is still exact, which is what stops a cut from making the layer jump.
  const curved = editProject(id, { expectedRevision: cut.revision, operations: [
    { type: "item.keyframes", sequenceId: seq.id, itemId: "mover", keyframes: [{ t: 0, x: 0, opacity: 0.4, ease: "ease" }, { t: 1.5, x: 35, opacity: 0.7 }] },
  ] });
  assert.equal(curved.edl.sequences[0].items[1].keyframes![0].ease, "ease");

  // And the test is not vacuous: the layer really does travel and fade up across the shot.
  assert.ok(was.at(-1)!.centre - was[0].centre > 300, `it travels: ${was.map(m => m.centre.toFixed(0))}`);
  assert.ok(was.at(-1)!.weight > was[0].weight * 1.8, `and fades up: ${was.map(m => m.weight.toFixed(1))}`);
});

test("a push-in shortened by the cut underneath it still renders", { timeout: 300_000 }, async () => {
  // Written as six tenths of a second, played as half of one, because a silence cut
  // sits inside it. At exactly twice the ramp the zoom's two middle moments are the
  // same moment, and a real export died on that at frame 419.
  const { createVideoProject } = await import("../src/lib/editor/media");
  const { readEditor, editProject } = await import("../src/lib/editor/store");
  const { renderProject } = await import("../src/lib/editor/render");

  const source = path.join(workspace, "punchy.mp4");
  ffmpeg(["-y", "-f", "lavfi", "-i", "color=0x203040:size=320x568:rate=12:duration=8",
    "-f", "lavfi", "-i", "sine=frequency=220:duration=8", "-shortest", "-pix_fmt", "yuv420p", "-c:a", "aac",
    "-vf", "drawbox=x=60:y=60:w=200:h=200:color=0xE08020@1:t=fill", source]);

  const { id } = await createVideoProject("Punchy", [{ file: source }]);
  const snapshot = readEditor(id);
  const sequenceId = snapshot.edl.sequences[0].id;
  const itemId = snapshot.edl.sequences[0].items[0].id;
  editProject(id, { expectedRevision: snapshot.revision, operations: [{
    type: "item.patch", sequenceId, itemId,
    patch: { start: 0, end: 8, captions: { preset: "none" }, edits: [
      // The cut takes 0.1s out of the middle of the punch: 0.6s written, 0.5s played.
      { type: "punch", t: 2, d: 0.6, scale: 1.2, by: "" },
      { type: "silence", t: 2.25, d: 0.1, by: "" },
      // And one that the cut swallows whole.
      { type: "punch", t: 5, d: 0.4, scale: 1.2, by: "" },
      { type: "silence", t: 4.9, d: 0.7, by: "" },
    ] },
  }] });

  const { outputs } = await renderProject(id, { only: [sequenceId] });
  const file = outputs[0].file;
  // It rendered at all, which is the test; and the frame in the middle of the punch is
  // zoomed, so the shortened punch still does its job.
  const { buildTimeMap, srcToOut } = await import("../src/lib/timeline");
  const map = buildTimeMap(readEditor(id).edl.sequences[0].items[0].clip);
  const at = srcToOut(map, 2.3);
  const near = (actual: number[], expected: number[], tolerance = 60) =>
    actual.length === 3 && actual.every((value, index) => Math.abs(value - expected[index]) <= tolerance);
  const { width } = readEditor(id).edl.sequences[0].output;
  const box = (sec: number) => {
    for (let x = 0; x < width; x += 8) if (near(pixel(file, sec, x, Math.round(readEditor(id).edl.sequences[0].output.height * 0.26)), [224, 128, 32])) return x;
    return width;
  };
  assert.ok(box(at) < box(0.2), `the punch zooms: box edge at ${box(at)} during it, ${box(0.2)} before it`);
});

test("the loudness a template asks for is in the exported audio, not only in the timeline", { timeout: 300_000 }, async () => {
  const { createVideoProject } = await import("../src/lib/editor/media");
  const { readEditor, editProject } = await import("../src/lib/editor/store");
  const { executeEditorTool } = await import("../src/lib/editor/tools");
  const { renderProject } = await import("../src/lib/editor/render");
  const { saveTemplate } = await import("../src/lib/templates/registry");

  // Quiet footage with room to grow: a tone at a fifth of full scale.
  const quiet = path.join(workspace, "quiet-level.mp4");
  ffmpeg(["-y", "-f", "lavfi", "-i", "color=0x203040:size=320x568:rate=12:duration=6",
    "-f", "lavfi", "-i", "sine=frequency=1000:duration=6", "-af", "volume=0.2",
    "-shortest", "-pix_fmt", "yuv420p", "-c:a", "aac", quiet]);

  const words = ["uno", "dos", "tres", "cuatro"].map((w, i) => ({ t: 0.5 + i * 0.6, d: 0.4, w }));
  const make = async (templateId: string, targetLufs: number | null) => {
    await saveTemplate({ id: templateId, extends: "talking-head", name: templateId,
      captions: { preset: "none" }, hook: { mode: "off" }, images: { mode: "off" },
      rhythm: { silence: { enabled: false }, punch: { enabled: false }, emphasis: { enabled: false } },
      output: { width: 320, height: 568, fps: 12 }, audio: { targetLufs } });
    const { id } = await createVideoProject(`Level ${templateId}`, [{ file: quiet }]);
    const start = readEditor(id);
    const sequenceId = start.edl.sequences[0].id;
    editProject(id, { expectedRevision: start.revision, operations: [
      { type: "item.patch", sequenceId, itemId: start.edl.sequences[0].items[0].id, patch: { start: 0, end: 6, words } },
    ] });
    await executeEditorTool(id, { tool: "template.apply", templateId, sequenceId, expectedRevision: readEditor(id).revision });
    const { outputs } = await renderProject(id, { only: [sequenceId] });
    return { file: outputs[0].file, volume: readEditor(id).edl.sequences[0].items[0].volume };
  };

  const asked = await make("levelled-render", -20);
  const left = await make("unlevelled-render", null);
  assert.ok(asked.volume !== undefined && asked.volume > 1.2, `the timeline says it is turned up: ${asked.volume}`);
  assert.equal(left.volume, undefined, "and the other is left alone");

  // What the sample values say, which is the only claim that matters.
  const loud = rms(asked.file, 1);
  const soft = rms(left.file, 1);
  assert.ok(loud > soft * 1.2, `the exported audio is louder: ${loud.toFixed(4)} against ${soft.toFixed(4)}`);
  assert.ok(Math.abs(loud / soft - asked.volume!) < 0.15, `and by the gain the template chose: ${(loud / soft).toFixed(2)} against ${asked.volume!.toFixed(2)}`);
});

test("an accent on a sentence the cuts removed does not land on the words that replace it", { timeout: 300_000 }, async () => {
  // An emphasis is written in source seconds over the sentence it belongs to. Cut that
  // sentence away and the span maps to no length at the cut's edge — and the half second
  // either side that makes an accent land on its own word would then colour whatever is
  // said there instead, in a colour nobody asked for, on a word nobody chose.
  const { createVideoProject } = await import("../src/lib/editor/media");
  const { readEditor, editProject } = await import("../src/lib/editor/store");
  const { renderProject } = await import("../src/lib/editor/render");

  const source = path.join(workspace, "accent-cut.mp4");
  ffmpeg(["-y", "-f", "lavfi", "-i", "color=black:size=1080x1920:rate=12:duration=12",
    "-f", "lavfi", "-i", "sine=frequency=300:duration=12", "-shortest", "-pix_fmt", "yuv420p", "-c:a", "aac", source]);

  // "Nvidia" is said twice: once in the sentence that gets cut, once in the one that stays.
  const words = [
    { t: 0.5, d: 0.4, w: "Nvidia" }, { t: 1.0, d: 0.4, w: "vende" }, { t: 1.5, d: 0.4, w: "chips." },
    // Straight after the cut, which is where the half second either side reaches.
    { t: 2.7, d: 0.4, w: "Nvidia" }, { t: 3.2, d: 0.4, w: "también" }, { t: 3.7, d: 0.4, w: "gana." },
  ];
  const { id } = await createVideoProject("Accent cut", [{ file: source }]);
  const snapshot = readEditor(id);
  const sequenceId = snapshot.edl.sequences[0].id;
  const itemId = snapshot.edl.sequences[0].items[0].id;
  editProject(id, { expectedRevision: snapshot.revision, operations: [{
    type: "item.patch", sequenceId, itemId,
    patch: {
      title: "Acento", start: 0, end: 8, words,
      captions: { preset: "karaoke", positionY: 0.6, fontSizePct: 5, maxWordsPerLine: 3, color: "#ffffff", highlight: "#ffffff" },
      edits: [
        // The first sentence goes, and with it the accent that belonged to it.
        { type: "silence", t: 0.4, d: 2.2, by: "" },
        { type: "emphasis", t: 0.5, d: 1.4, words: ["Nvidia"], color: "#ff0000", by: "" },
      ],
    },
  }] });

  const { outputs } = await renderProject(id, { only: [sequenceId] });
  const file = outputs[0].file;
  const { buildTimeMap, srcToOut } = await import("../src/lib/timeline");
  const map = buildTimeMap(readEditor(id).edl.sequences.find((s) => s.id === sequenceId)!.items.find((i) => i.id === itemId)!.clip);
  const at = srcToOut(map, 2.9);

  /** The reddest pixel in the caption band: an accent in red would show up as one. */
  const band = ffmpeg(["-ss", String(at), "-i", file, "-frames:v", "1",
    "-vf", "crop=1080:200:0:1130", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
  let reddest = 0;
  for (let i = 0; i + 2 < band.length; i += 3) {
    const red = band[i] - Math.max(band[i + 1], band[i + 2]);
    if (band[i] > 100 && red > reddest) reddest = red;
  }
  assert.ok(reddest < 40, `the surviving "Nvidia" is not accented: ${reddest}/255 of red over the other channels`);
});

test("a picture the cuts shorten still exports", { timeout: 300_000 }, async () => {
  // The same shape as the push-in that crashed a real export: an eased span builds an
  // interpolation range from its own start and end, and a span the cuts shorten to less
  // than the ease itself produces a range that runs backwards. Remotion refuses it, and
  // the whole export dies — on a picture a template placed on a sentence that a
  // false-start cut then removed.
  const { createVideoProject } = await import("../src/lib/editor/media");
  const { readEditor, editProject } = await import("../src/lib/editor/store");
  const { renderProject } = await import("../src/lib/editor/render");
  const { uploadLibraryAsset } = await import("../src/lib/assets");

  const source = path.join(workspace, "short-picture.mp4");
  ffmpeg(["-y", "-f", "lavfi", "-i", "color=0x203040:size=1080x1920:rate=12:duration=10",
    "-f", "lavfi", "-i", "sine=frequency=300:duration=10", "-shortest", "-pix_fmt", "yuv420p", "-c:a", "aac", source]);
  const pictureFile = path.join(workspace, "short-picture.png");
  ffmpeg(["-y", "-f", "lavfi", "-i", "color=0xFF2040:size=400x400", "-frames:v", "1", pictureFile]);
  const picture = await uploadLibraryAsset("short-picture.png", await fs.readFile(pictureFile));

  const { id } = await createVideoProject("Short picture", [{ file: source }]);
  const snapshot = readEditor(id);
  const sequenceId = snapshot.edl.sequences[0].id;
  editProject(id, { expectedRevision: snapshot.revision, operations: [{
    type: "item.patch", sequenceId, itemId: snapshot.edl.sequences[0].items[0].id,
    patch: {
      title: "Corta", start: 0, end: 8,
      words: [{ t: 0.5, d: 0.4, w: "hola" }, { t: 4.0, d: 0.4, w: "adiós" }],
      edits: [
        // A picture for a second, with most of that second cut out from under it.
        { type: "image", t: 2.0, d: 1.0, src: picture.id, y: 0.4, x: null, widthPct: 40, heightPct: 30, style: "plain", by: "" },
        { type: "silence", t: 2.1, d: 0.8, by: "" },
        // And one the cuts remove entirely.
        { type: "image", t: 5.2, d: 0.5, src: picture.id, y: 0.4, x: null, widthPct: 40, heightPct: 30, style: "plain", by: "" },
        { type: "silence", t: 5.1, d: 0.9, by: "" },
      ],
    },
  }] });

  const { outputs } = await renderProject(id, { only: [sequenceId] });
  assert.ok(outputs[0]?.file, "the export finished");
  // The shortened picture is still shown where it survives.
  const { buildTimeMap, srcToOut } = await import("../src/lib/timeline");
  const map = buildTimeMap(readEditor(id).edl.sequences.find((s) => s.id === sequenceId)!.items[0].clip);
  const at = srcToOut(map, 2.05);
  const seen = pixel(outputs[0].file, at, 540, Math.round(1920 * 0.4));
  assert.ok(seen[0] > 120 && seen[0] > seen[2] + 40, `the picture is on screen at ${at.toFixed(2)}s, saw ${seen}`);
});
