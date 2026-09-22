import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { Clip, Edl } from "../types";
import { applyOperations } from "../lib/operations";
import { sequenceFrames } from "../lib/sequences";
import { FFMPEG } from "../../../common/server/bin";

/**
 * A shot's own sound: separating it from the picture, seeing its shape, and finding a
 * new one. All three are shared services — the panel and the agent reach the same code.
 */
let workspace: string;
let store: typeof import("../server/store");
let mediaService: typeof import("../../media/server/media-import");
let tools: typeof import("../server/tools");
let database: typeof import("../../../common/server/db");
let assets: typeof import("../../media/server/assets");
let source: string;

before(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agentcut-audio-"));
  process.env.AGENTCUT_WORKSPACE = workspace;
  [store, mediaService, tools, database, assets] = await Promise.all([
    import("../server/store"), import("../../media/server/media-import"),
    import("../server/tools"), import("../../../common/server/db"), import("../../media/server/assets"),
  ]);
  source = path.join(workspace, "talking.mp4");
  // Two seconds of colour with a tone under it, so the file really has an audio track.
  const result = spawnSync(FFMPEG, [
    "-y", "-f", "lavfi", "-i", "color=blue:size=160x90:rate=10:duration=2",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
    "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", source,
  ], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});
after(async () => { database.db.close(); await fs.rm(workspace, { recursive: true, force: true }); });

const fixture = () => Edl.parse({
  projectId: "audio", source: null, clips: [],
  media: [{ id: "m1", name: "talking.mp4", file: "/tmp/talking.mp4", width: 640, height: 360, fps: 10, durationSec: 20 }],
  sequences: [{ id: "main", title: "Main", output: { width: 640, height: 360, fps: 10 }, items: [
    { id: "shot", mediaId: "m1", clip: Clip.parse({ id: "shot", title: "Shot", start: 2, end: 8,
      edits: [{ type: "silence", t: 1, d: 2 }, { type: "text", t: 0, d: 2, text: "Hook" }] }) },
  ] }],
});

test("separating a shot's audio keeps its length, mutes the picture and leaves the overlays alone", () => {
  const edl = fixture();
  const before = sequenceFrames(edl.sequences[0]);
  const next = applyOperations(edl, [{ type: "item.detachAudio", sequenceId: "main", itemId: "shot", newItemId: "shot-audio" }]);
  const [picture, audio] = next.sequences[0].items;
  assert.equal(picture.muted, true, "the picture goes quiet");
  assert.equal(picture.clip.edits.length, 2, "its hook stays on the picture");
  assert.equal(audio.mediaId, "m1", "the sound is the same footage, without its picture");
  assert.equal(audio.hidden, true);
  assert.equal(audio.muted, false);
  assert.equal(audio.layer, 1, "it lands on a track of its own");
  assert.equal(audio.at, 0);
  assert.deepEqual([audio.clip.start, audio.clip.end], [2, 8], "the same span of the file");
  assert.deepEqual(audio.clip.edits.map(e => e.type), ["silence"], "silence cuts come along; the hook does not");
  const after = sequenceFrames(next.sequences[0]);
  assert.equal(after.items[1].duration, before.items[0].duration, "sound and picture stay the same length");
  assert.equal(after.duration, before.duration, "and the video does not get longer");
});

test("separating audio refuses a canvas scene, a muted shot, and a second pass", () => {
  const edl = fixture();
  edl.sequences[0].items.push({ id: "title", mediaId: null, clip: Clip.parse({ id: "title", title: "Title", start: 0, end: 2 }) });
  assert.throws(() => applyOperations(edl, [{ type: "item.detachAudio", sequenceId: "main", itemId: "title", newItemId: "x" }]), /no footage audio/);
  const once = applyOperations(edl, [{ type: "item.detachAudio", sequenceId: "main", itemId: "shot", newItemId: "shot-audio" }]);
  assert.throws(() => applyOperations(once, [{ type: "item.detachAudio", sequenceId: "main", itemId: "shot", newItemId: "again" }]), /muted/);
  assert.throws(() => applyOperations(edl, [{ type: "item.detachAudio", sequenceId: "main", itemId: "shot", newItemId: "not an id" }]));
});

test("the visual editor and the agent separate audio through the same operation and revision", async () => {
  const { id } = await mediaService.createVideoProject("Has sound", [{ file: source }, { file: source }]);
  const initial = store.readEditor(id);
  const sequenceId = initial.edl.sequences[0].id;
  const [first, second] = initial.edl.sequences[0].items;

  // What the panel's button dispatches, through the project's HTTP endpoint.
  const operations = [{ type: "item.detachAudio", sequenceId, itemId: first.id, newItemId: "ui_audio" }];
  const expected = applyOperations(initial.edl, operations);
  const { PATCH } = await import("../../../app/api/projects/[id]/route");
  const { NextRequest } = await import("next/server");
  const response = await PATCH(
    new NextRequest(`http://localhost/api/projects/${id}`, { method: "PATCH", body: JSON.stringify({ expectedRevision: initial.revision, operations }) }),
    { params: Promise.resolve({ id }) },
  );
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).edl, expected);

  // And the same call from the agent, on the other shot.
  const current = store.readEditor(id);
  await tools.executeEditorTool(id, { tool: "project.edit", expectedRevision: current.revision, operations: [
    { type: "item.detachAudio", sequenceId, itemId: second.id, newItemId: "agent_audio" },
  ] });
  const saved = store.readEditor(id);
  const detached = saved.edl.sequences[0].items.filter(item => item.hidden);
  assert.deepEqual(detached.map(item => item.id), ["ui_audio", "agent_audio"]);
  assert.ok(detached.every(item => item.clip.title.endsWith("(audio)")), detached.map(item => item.clip.title).join(", "));
  assert.ok(saved.edl.sequences[0].items.filter(item => !item.hidden).every(item => item.muted), "both pictures are quiet");
  // The agent's edit did not undo the human's.
  assert.equal(saved.edl.sequences[0].items.length, 4);
});

test("peaks are computed on this machine, normalised, and cached next to the project", async () => {
  const { id } = await mediaService.createVideoProject("Peaks", [{ file: source }]);
  const media = store.readEditor(id).edl.media[0];
  const { mediaPeaks } = await import("../../media/server/peaks");
  const first = await mediaPeaks(id, media);
  assert.equal(first.rate, 10);
  assert.ok(first.peaks.length >= 15, `a two-second tone is about twenty buckets, got ${first.peaks.length}`);
  assert.ok(first.peaks.every(p => p >= 0 && p <= 1), "normalised to 0..1");
  assert.ok(Math.max(...first.peaks) > 0.5, "a sine at full level reads loud");
  const { projectDir } = await import("../../../common/server/config");
  const cache = path.join(projectDir(id), "cache", `peaks-${media.id}.json`);
  assert.deepEqual(JSON.parse(await fs.readFile(cache, "utf8")), first);
  // Silent footage is a normal answer, not a failure.
  const silent = path.join(workspace, "silent.mp4");
  assert.equal(spawnSync(FFMPEG, ["-y", "-f", "lavfi", "-i", "color=black:size=80x80:rate=5:duration=1", "-pix_fmt", "yuv420p", silent], { encoding: "utf8" }).status, 0);
  const { audioPeaks } = await import("../../media/server/ffmpeg");
  assert.deepEqual(await audioPeaks(silent), { rate: 10, peaks: [] });
});

test("the starter sounds install once, as ordinary library assets the agent can list", async () => {
  assert.equal(await assets.installStarterSounds(), assets.STARTER_SOUNDS.length);
  const { id } = await mediaService.createVideoProject("Sounds", []);
  const listed = await tools.executeEditorTool(id, { tool: "assets.list", kind: "audio" }) as Array<{ name: string; kind: string; license: string | null }>;
  assert.ok(listed.some(sound => sound.name === "Whoosh"), listed.map(s => s.name).join(", "));
  assert.ok(listed.every(sound => sound.kind === "audio"));
  // Installed once: deleting one is a decision, not a glitch to repair on the next read.
  assert.equal(await assets.installStarterSounds(), 0);
  await assets.scanLibrary();
  assert.equal((await tools.executeEditorTool(id, { tool: "assets.list", kind: "audio" }) as unknown[]).length, listed.length);
});
