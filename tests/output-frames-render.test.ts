import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { FFMPEG } from "../src/lib/bin";

/**
 * The editing agent looks at the video, not at the footage.
 *
 * These are the tests that actually render, because the whole claim is about pixels:
 * a title the source frame does not contain, a joint where two shots are on screen at
 * once, a framing caught part-way through a move across the source, and a layer caught
 * part-way across the output frame. A source frame of any of those four shows something
 * that is not what the viewer sees, which is precisely what the agent used to be handed.
 * The cheap half — every way this declines to render, and the wording it declines with —
 * lives in tests/conversation.test.ts.
 *
 * `test:render` runs with `--test-force-exit` because of this file. Remotion's public
 * `renderFrames()` opens its own static server and closes it without `force`, which in
 * 4.0.525 never completes: two sockets stay open for reuse and the process never exits.
 * An export does not hit it — `renderMedia` owns that server and force-closes it. It is
 * a warm cache, not a leak: sampling three times in a row leaves the same two sockets
 * and makes each later sample three times faster. Nothing to fix, but a test process
 * still has to be able to end.
 */

let workspace: string;
let database: typeof import("../src/lib/db");

before(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agentcut-output-frames-"));
  process.env.AGENTCUT_WORKSPACE = workspace;
  database = await import("../src/lib/db");
});
after(async () => { database.db.close(); await fs.rm(workspace, { recursive: true, force: true }); });

function ffmpeg(args: string[]) {
  const result = spawnSync(FFMPEG, ["-v", "error", ...args], { maxBuffer: 1 << 28 });
  assert.equal(result.status, 0, result.stderr.toString());
  return result.stdout;
}

/** A decoded still, as flat rgb triples. */
function rgb(file: string) {
  return ffmpeg(["-i", file, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
}

/** How much of a still is not the flat colour the footage behind it is. */
function unlike(buf: Buffer, colour: [number, number, number]) {
  let n = 0;
  for (let i = 0; i < buf.length; i += 3) {
    const far = Math.max(Math.abs(buf[i] - colour[0]), Math.abs(buf[i + 1] - colour[1]), Math.abs(buf[i + 2] - colour[2]));
    if (far > 70) n += 1;
  }
  return n / (buf.length / 3);
}

/** Average colour of the middle of a still. */
function centre(buf: Buffer, width: number, height: number) {
  const sum = [0, 0, 0];
  let n = 0;
  for (let y = (height >> 1) - 5; y < (height >> 1) + 5; y++) {
    for (let x = (width >> 1) - 5; x < (width >> 1) + 5; x++) {
      const i = (y * width + x) * 3;
      sum[0] += buf[i]; sum[1] += buf[i + 1]; sum[2] += buf[i + 2]; n += 1;
    }
  }
  return sum.map((c) => Math.round(c / n)) as [number, number, number];
}

/** The average column of the blue pixels in a still: where a blue layer has got to. */
function blueCentre(buf: Buffer, width: number) {
  let sum = 0, n = 0;
  for (let i = 0; i < buf.length; i += 3) {
    if (buf[i + 2] > buf[i] + 60 && buf[i + 2] > buf[i + 1] + 60) { sum += (i / 3) % width; n += 1; }
  }
  return n ? sum / n : -1;
}

/** What share of a still leans red, and what share leans blue. */
function sides(buf: Buffer) {
  let red = 0, blue = 0;
  for (let i = 0; i < buf.length; i += 3) {
    if (buf[i] > buf[i + 2] + 60) red += 1;
    if (buf[i + 2] > buf[i] + 60) blue += 1;
  }
  const total = buf.length / 3;
  return { red: red / total, blue: blue / total };
}

const flat = (name: string, colour: string, seconds: number) => {
  const file = path.join(workspace, `${name}.mp4`);
  ffmpeg(["-y", "-f", "lavfi", "-i", `color=${colour}:size=640x360:rate=10:duration=${seconds}`, "-pix_fmt", "yuv420p", file]);
  return file;
};

/** One source whose left half is red and right half blue, so a pan across it is visible. */
const halves = (name: string, seconds: number) => {
  const file = path.join(workspace, `${name}.mp4`);
  ffmpeg(["-y", "-f", "lavfi", "-i", `color=red:size=320x360:rate=10:duration=${seconds}`,
    "-f", "lavfi", "-i", `color=blue:size=320x360:rate=10:duration=${seconds}`,
    "-filter_complex", "[0:v][1:v]hstack=inputs=2", "-pix_fmt", "yuv420p", file]);
  return file;
};

const shot = (id: string, mediaId: string, seconds: number, extra: object = {}) => ({
  id, mediaId,
  clip: { id, title: id, start: 0, end: seconds, crop: [], layout: { type: "crop" }, captions: { preset: "none" },
    words: [], edits: [], hook: "", reason: "", score: 50, tags: [] },
  muted: true,
  ...extra,
});

/** Build a project from `files` and replace its timeline with `items`. */
async function timeline(name: string, files: string[], items: (mediaIds: string[]) => object[]) {
  const { createVideoProject } = await import("../src/lib/editor/media");
  const { readEditor, editProject } = await import("../src/lib/editor/store");
  const { id } = await createVideoProject(name, files.map((file) => ({ file })), { transcribe: false });
  const initial = readEditor(id);
  const seq = initial.edl.sequences[0];
  const mediaIds = initial.edl.media.map((m) => m.id);
  const state = editProject(id, { expectedRevision: initial.revision, operations: [
    { type: "sequence.remove", sequenceId: seq.id },
    { type: "sequence.add", sequence: { ...seq, output: { width: 640, height: 360, fps: 10 }, items: items(mediaIds) } },
  ] });
  return { id, sequenceId: seq.id, state, mediaIds };
}

/** Run one turn and return the run directory's frames and manifest, as the agent sees them. */
async function turn(id: string, sequenceId: string) {
  const { runEditorAgent } = await import("../src/lib/editor/agent");
  let seen: { dir: string; manifest: Record<string, never>; files: string[]; prompt: string } | null = null;
  await runEditorAgent(id, "Look at this", { context: { sequenceId }, runner: {
    id: "test", label: "Test", available: async () => true,
    run: async (o) => {
      seen = {
        dir: path.join(o.cwd, "frames"),
        manifest: JSON.parse(await fs.readFile(path.join(o.cwd, "frames.json"), "utf8")),
        files: (await fs.readdir(path.join(o.cwd, "frames")).catch(() => [])).sort(),
        prompt: o.prompt,
      };
      return { provider: "test", text: "Looked.", events: [], durationMs: 1 };
    },
  } });
  return seen! as { dir: string; manifest: Record<string, string & number & never[]>; files: string[]; prompt: string };
}

test("the agent's frames carry the title the footage never had", { timeout: 240_000 }, async () => {
  const orange = flat("orange", "orange", 6);
  const { id, sequenceId } = await timeline("titled", [orange], ([media]) => [
    shot("only", media, 6, { clip: { id: "only", title: "only", start: 0, end: 6, crop: [], layout: { type: "crop" },
      captions: { preset: "none" }, words: [], hook: "", reason: "", score: 50, tags: [],
      edits: [{ type: "text", t: 0, d: 6, text: "WATCH THIS", position: "bottom", style: "card" }] } }),
  ]);

  const seen = await turn(id, sequenceId);
  assert.equal(seen.manifest.kind, "output", `expected rendered output, got ${JSON.stringify(seen.manifest)}`);
  assert.equal(seen.manifest.width, 640);
  assert.equal(seen.manifest.height, 360, "360 on the short side of a landscape video");
  assert.equal(seen.manifest.cadenceSec, 2, "decision 29's two seconds");
  assert.equal(seen.manifest.complete, true);
  assert.deepEqual(seen.files, ["frame-0.0.jpg", "frame-2.0.jpg", "frame-4.0.jpg"], "named by the second of the finished video they show");
  assert.ok((seen.manifest.missing as unknown as string[]).some((m) => /sound/.test(m)), "a still cannot carry the audio, and says so");
  assert.match(seen.prompt, /FINISHED video/);
  assert.match(seen.prompt, /rendered output at 640×360 every 2s/);

  // The claim, in pixels: the rendered frame has a title on it and the footage does not.
  const rendered = rgb(path.join(seen.dir, "frame-2.0.jpg"));
  const ORANGE: [number, number, number] = [255, 165, 0];
  assert.ok(unlike(rendered, ORANGE) > 0.01, `the rendered frame carries something over the footage: ${unlike(rendered, ORANGE)}`);

  const { grabFrame } = await import("../src/lib/media");
  const source = path.join(workspace, "source-at-2s.jpg");
  await grabFrame(orange, 2, source, 640);
  assert.ok(unlike(rgb(source), ORANGE) < 0.005, `and the source frame at the same second is bare footage: ${unlike(rgb(source), ORANGE)}`);
});

test("a frame sampled inside a joint has both shots in it, which no source frame can show", { timeout: 240_000 }, async () => {
  const red = flat("t-red", "red", 4), blue = flat("t-blue", "blue", 4);
  // One second between frames, so one of them lands halfway through a two-second joint
  // rather than on either lip of it. The cadence is a knob for exactly this reason.
  process.env.AGENTCUT_OUTPUT_FRAMES_CADENCE = "1";
  try {
    const { id, sequenceId, state } = await timeline("joint", [red, blue], ([a, b]) => [
      shot("first", a, 4),
      shot("second", b, 4, { transition: { kind: "dissolve", durationSec: 2, color: "#000000", direction: "left", by: "" } }),
    ]);
    const { sequenceFrames } = await import("../src/lib/sequences");
    const resolved = sequenceFrames(state.edl.sequences[0]);
    assert.equal(resolved.duration, 60, "the overlap comes out of the programme: 4s + 4s − 2s");
    assert.equal(resolved.items[1].from, 20, "the joint runs from 2.0s to 4.0s");

    const seen = await turn(id, sequenceId);
    assert.equal(seen.manifest.kind, "output");
    assert.ok(seen.files.includes("frame-3.0.jpg"), `wanted a frame in the joint, got ${seen.files}`);

    const before = centre(rgb(path.join(seen.dir, "frame-1.0.jpg")), 640, 360);
    const middle = centre(rgb(path.join(seen.dir, "frame-3.0.jpg")), 640, 360);
    const after = centre(rgb(path.join(seen.dir, "frame-5.0.jpg")), 640, 360);
    assert.ok(before[0] > before[2] + 80, `the first shot is itself before the joint: ${before}`);
    assert.ok(after[2] > after[0] + 80, `the second shot is whole after it: ${after}`);
    assert.ok(middle[0] > 40 && middle[2] > 40, `inside the joint both shots are on screen at once: ${middle}`);
    assert.ok(middle[0] < before[0] - 40 && middle[2] < after[2] - 40, `and neither has won it yet: ${middle}`);
  } finally { delete process.env.AGENTCUT_OUTPUT_FRAMES_CADENCE; }
});

test("a frame sampled mid-move shows where the framing has got to, not where it started", { timeout: 240_000 }, async () => {
  const split = halves("panned", 4);
  process.env.AGENTCUT_OUTPUT_FRAMES_CADENCE = "1";
  try {
    const { id, sequenceId } = await timeline("pan", [split], ([media]) => [
      shot("pan", media, 4, { clip: { id: "pan", title: "pan", start: 0, end: 4, layout: { type: "crop" },
        captions: { preset: "none" }, words: [], edits: [], hook: "", reason: "", score: 50, tags: [],
        // A window half the width of the source, travelling from its left edge to its right
        // over the shot's own four seconds. The renderer interpolates between the two.
        crop: [{ t: 0, x: 0, y: 90, w: 320, h: 180 }, { t: 4, x: 320, y: 90, w: 320, h: 180 }] } }),
    ]);

    const seen = await turn(id, sequenceId);
    assert.equal(seen.manifest.kind, "output");
    const start = sides(rgb(path.join(seen.dir, "frame-0.0.jpg")));
    const half = sides(rgb(path.join(seen.dir, "frame-2.0.jpg")));
    const end = sides(rgb(path.join(seen.dir, "frame-3.0.jpg")));
    assert.ok(start.red > 0.9, `the move starts on the left of the source: ${JSON.stringify(start)}`);
    assert.ok(end.blue > 0.7, `and is well to the right by the end: ${JSON.stringify(end)}`);
    assert.ok(half.red > 0.25 && half.blue > 0.25,
      `halfway the window straddles the seam, which a frame grabbed at the shot's start could never show: ${JSON.stringify(half)}`);
  } finally { delete process.env.AGENTCUT_OUTPUT_FRAMES_CADENCE; }
});

test("a frame sampled mid-move shows where a keyframed layer has travelled to", { timeout: 240_000 }, async () => {
  // The crop test above catches a move *inside* the source. This one is the other kind:
  // the layer itself travelling across the output frame, which is what `item.keyframes`
  // animates and what no frame grabbed out of a source file can show at all — the source
  // is one flat colour from end to end.
  const bed = flat("layer-red", "red", 4), pip = flat("layer-blue", "blue", 4);
  process.env.AGENTCUT_OUTPUT_FRAMES_CADENCE = "1";
  try {
    const { id, sequenceId } = await timeline("layer-move", [bed, pip], ([a, b]) => [
      shot("bed", a, 4),
      shot("pip", b, 4, { at: 0, layer: 1,
        transform: { x: 0, y: 40, width: 20, height: 20, rotation: 0, opacity: 1 },
        keyframes: [{ t: 0, x: 0 }, { t: 4, x: 80 }] }),
    ]);

    const seen = await turn(id, sequenceId);
    assert.equal(seen.manifest.kind, "output");
    const centres = ["frame-0.0.jpg", "frame-1.0.jpg", "frame-3.0.jpg"]
      .map((name) => blueCentre(rgb(path.join(seen.dir, name)), 640));
    assert.ok(centres.every((c) => c >= 0), `the layer is on every still: ${centres}`);
    assert.ok(centres[0] < 120, `it starts at the left edge of the frame: ${centres}`);
    assert.ok(centres[1] > centres[0] + 80, `a second later it has moved: ${centres}`);
    assert.ok(centres[2] > 380, `and by three seconds it is well to the right: ${centres}`);
  } finally { delete process.env.AGENTCUT_OUTPUT_FRAMES_CADENCE; }
});

test("a turn that changed nothing renders nothing; one that changed the picture renders again", { timeout: 240_000 }, async () => {
  const { outputFrames } = await import("../src/lib/editor/frames");
  const { readEditor, editProject } = await import("../src/lib/editor/store");
  const green = flat("cache-green", "green", 6);
  const { id } = await timeline("cache", [green], ([media]) => [shot("one", media, 6)]);

  const first = await outputFrames(id, readEditor(id).edl, readEditor(id).edl.sequences[0]);
  assert.equal(first.cached, false, "the first look renders");
  assert.ok(first.ms > 100, `and it costs real time: ${first.ms}ms`);

  const again = await outputFrames(id, readEditor(id).edl, readEditor(id).edl.sequences[0]);
  assert.equal(again.cached, true, "the second look, with nothing changed, renders nothing");
  assert.equal(again.key, first.key);
  assert.ok(again.ms < 100, `and costs nothing: ${again.ms}ms`);

  // A second video in the same project moves the saved revision without moving a pixel
  // of this one. Keying on the revision would throw these frames away; keying on the
  // picture keeps them.
  const beforeUnrelated = readEditor(id);
  const elsewhere = editProject(id, { expectedRevision: beforeUnrelated.revision, operations: [
    { type: "sequence.add", sequence: { id: "other", title: "Another video", output: { width: 640, height: 360, fps: 10 }, items: [], plan: {} } },
  ] });
  assert.ok(elsewhere.revision > beforeUnrelated.revision, "the revision moved");
  const unrelated = await outputFrames(id, elsewhere.edl, elsewhere.edl.sequences.find((s) => s.id !== "other")!);
  assert.equal(unrelated.cached, true, "but this video looks exactly as it did, so its frames stand");

  // Putting a title on it does change the picture.
  const changed = editProject(id, { expectedRevision: readEditor(id).revision, operations: [
    { type: "item.edit.add", sequenceId: readEditor(id).edl.sequences[0].id, itemId: "one",
      edit: { type: "text", t: 0, d: 6, text: "NEW TITLE", position: "top", style: "card" } },
  ] });
  const after = await outputFrames(id, changed.edl, changed.edl.sequences[0]);
  assert.equal(after.cached, false, "a title that was not there before is a different picture");
  assert.notEqual(after.key, first.key);
});

test("a render that fails hands the agent footage frames and says why", { timeout: 240_000 }, async () => {
  const here = flat("still-here", "purple", 4), gone = flat("vanishing", "green", 4);
  const { id, sequenceId } = await timeline("broken", [here, gone], ([a, b]) => [shot("one", a, 4), shot("two", b, 4)]);
  // One of the two sources is no longer on disk. The project is still perfectly valid
  // and ffmpeg can still grab frames from the other shot; it is the render that breaks.
  const { readEditor } = await import("../src/lib/editor/store");
  const missing = readEditor(id).edl.media.find((m) => m.name.includes("vanishing"));
  assert.ok(missing, `expected both sources on the timeline: ${readEditor(id).edl.media.map((m) => m.name)}`);
  await fs.rm(missing.file, { force: true });

  const seen = await turn(id, sequenceId);
  assert.equal(seen.manifest.kind, "source", "a broken render is not allowed to look like a good one");
  assert.match(String(seen.manifest.reason), /render failed|no frames within/);
  assert.ok(seen.files.length > 0, "the footage that is still there is still grabbed");
  assert.match(seen.prompt, /SOURCE FOOTAGE, not of the finished video/);
  assert.match(seen.prompt, /are NOT in these pictures/);
});
