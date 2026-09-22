import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { FFMPEG } from "../../../common/server/bin";
import type { AgentProvider } from "../../agent/lib/providers";

let workspace: string;
let sources: string[];
let store: typeof import("../../editor/server/store");
let mediaService: typeof import("../../media/server/media-import");
let database: typeof import("../../../common/server/db");
let batch: typeof import("../server/batch");
let conversation: typeof import("../../agent/server/conversation");

before(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agentcut-batch-"));
  process.env.AGENTCUT_WORKSPACE = workspace;
  [store, mediaService, database, batch, conversation] = await Promise.all([
    import("../../editor/server/store"), import("../../media/server/media-import"), import("../../../common/server/db"), import("../server/batch"), import("../../agent/server/conversation"),
  ]);
  const { resetBrandIndex, brandIndex } = await import("../../media/server/search/brand");
  resetBrandIndex();
  await fs.mkdir(path.join(workspace, "cache"), { recursive: true });
  await fs.writeFile(path.join(workspace, "cache", "brands.json"), JSON.stringify([]));
  await brandIndex();
  sources = [];
  for (const [i, colour] of ["navy", "maroon", "teal"].entries()) {
    const file = path.join(workspace, `raw-${i + 1}.mp4`);
    const result = spawnSync(FFMPEG, ["-y", "-f", "lavfi", "-i", `color=${colour}:size=320x180:rate=15:duration=8`,
      "-f", "lavfi", "-i", "sine=frequency=300:duration=8", "-pix_fmt", "yuv420p", "-shortest", file], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    sources.push(file);
  }
});
after(async () => { database.db.close(); await fs.rm(workspace, { recursive: true, force: true }); });

/** A planner that writes a plan for whatever it is asked, and fails on a named video. */
function planner(failOn?: string): AgentProvider {
  return { id: "test", label: "Test", available: async () => true, run: async (o) => {
    const files = await fs.readdir(o.cwd);
    if (files.includes("videos.json")) {
      const videos = JSON.parse(await fs.readFile(path.join(o.cwd, "videos.json"), "utf8")) as Array<{ id: string; summary: string }>;
      await fs.writeFile(path.join(o.cwd, "project-plan.json"), JSON.stringify({ template: "talking-head", series: { enabled: true, order: videos.map((v) => v.id), numbering: "n-of-total", covered: videos.map((v) => v.summary).filter(Boolean) } }));
    } else {
      const material = JSON.parse(await fs.readFile(path.join(o.cwd, "material.json"), "utf8")) as { title: string; items: Array<{ id: string }> };
      if (failOn && material.title === failOn) throw new Error("planner crashed");
      await fs.writeFile(path.join(o.cwd, "plan.json"), JSON.stringify({ summary: `About ${material.title}`, tags: ["raw"], beats: [{ kind: "hook", intent: "open", itemId: material.items[0].id, atSec: 0, durationSec: 2 }] }));
    }
    return { provider: "test", text: "DONE", events: [], durationMs: 1 };
  } };
}

test("a batch project is one video per raw file, and the batch plans and edits each under the shared plan", async () => {
  const { id } = await mediaService.createVideoProject("Tips", sources.map((file) => ({ file })), { layout: "separate" });
  const start = store.readEditor(id);
  assert.equal(start.edl.sequences.length, 3);
  assert.deepEqual(start.edl.sequences.map((s) => s.title), ["raw-1", "raw-2", "raw-3"]);
  assert.ok(start.edl.sequences.every((s) => s.items.length === 1 && s.plan.status === "pending"));

  const stages: string[] = [];
  const logs: string[] = [];
  const result = await batch.runBatch(id, { brief: "Three tips for new users", runner: planner("raw-2"), transcribe: false, concurrency: 2, onStage: (s) => stages.push(s), onLog: (k, t) => logs.push(`${k}: ${t}`) });
  assert.deepEqual(result.videos.map((v) => [v.title, v.ok]), [["raw-1", true], ["raw-2", false], ["raw-3", true]]);
  assert.match(result.videos[1].error!, /planner crashed/);
  assert.ok(stages.includes("planning the set") && stages.includes("editing 3/3") && stages.includes("closing the set"), stages.join(", "));

  const after = store.readEditor(id);
  assert.equal(after.edl.plan.brief.goal, "Three tips for new users");
  assert.equal(after.edl.plan.template, "talking-head");
  assert.equal(after.edl.plan.series.numbering, "n-of-total");
  assert.deepEqual(after.edl.plan.series.covered, ["About raw-1", "About raw-3"], "the closing pass knows what the edited videos cover");
  const [one, two, three] = after.edl.sequences;
  assert.equal(one.plan.status, "edited"); assert.equal(three.plan.status, "edited");
  assert.equal(one.plan.summary, "About raw-1");
  assert.ok(one.items[0].clip.edits.every((e) => e.by.startsWith("template:talking-head/plan")));
  assert.equal(two.plan.status, "pending", "a failed video is left pending");
  assert.match(two.plan.reasons.error, /planner crashed/);
  assert.equal(conversation.readConversation(id)[0].source, "brief");

  // Re-running only touches what is still pending.
  const again = await batch.runBatch(id, { runner: planner(), transcribe: false });
  assert.deepEqual(again.videos.map((v) => [v.title, v.ok]), [["raw-2", true]]);
  assert.equal(store.readEditor(id).edl.sequences[1].plan.status, "edited");
  const nothing = await batch.runBatch(id, { runner: planner(), transcribe: false });
  assert.equal(nothing.videos.length, 0);
});

test("rendering without a list covers approved videos only, once anything is approved, and marks them rendered", async () => {
  const { id } = await mediaService.createVideoProject("Gate", sources.slice(0, 2).map((file) => ({ file })), { layout: "separate" });
  const start = store.readEditor(id);
  const [a, b] = start.edl.sequences.map((s) => s.id);
  assert.equal(batch.renderTargets(start.edl), undefined, "nothing approved: nothing to gate");
  assert.deepEqual(batch.renderTargets(start.edl, [b]), [b]);
  store.editProject(id, { expectedRevision: start.revision, operations: [{ type: "sequence.plan.patch", sequenceId: a, patch: { status: "approved" } }] });
  assert.deepEqual(batch.renderTargets(store.readEditor(id).edl), [a]);
  batch.markRendered(id, [a, b]);
  const after = store.readEditor(id).edl;
  assert.equal(after.sequences[0].plan.status, "rendered");
  assert.equal(after.sequences[1].plan.status, "rendered");
  assert.deepEqual(batch.renderTargets(after), [a, b]);
});

test("transcribing imported media puts words on its shots and a missing recogniser is reported, not thrown", async () => {
  const { id } = await mediaService.createVideoProject("Words", [{ file: sources[0] }], { layout: "separate" });
  const { transcribeProjectMedia } = await import("../../transcription/server/media");
  const mediaId = store.readEditor(id).edl.media[0].id;
  await assert.rejects(transcribeProjectMedia(id, { mediaIds: ["nope"] }), /Media not found/);
  const { results } = await transcribeProjectMedia(id, { mediaIds: [mediaId] });
  assert.equal(results.length, 1);
  if (results[0].error) assert.match(results[0].error, /whisper|not found|ENOENT|failed/i);
  else assert.equal(results[0].items, 1);
});

test("a batch reuses the transcript an import already produced, and still skips a source with nothing on its audio track", async () => {
  const transcribe = await import("../../transcription/server/transcribe");
  const { Transcript } = await import("../../transcription/lib/transcript");
  const engine = await import("../../transcription/server/whispercpp");
  let calls = 0;
  transcribe.setDefaultRecogniser(async () => { calls += 1; return Transcript.parse({ engine: engine.engineId(), segments: [], words: [{ t: 0, d: 0.4, w: "hola" }] }); });
  try {
    const quiet = path.join(workspace, "quiet.mp4");
    assert.equal(spawnSync(FFMPEG, ["-y", "-f", "lavfi", "-i", "color=black:size=320x180:rate=15:duration=4",
      "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono:d=4", "-pix_fmt", "yuv420p", "-shortest", quiet], { encoding: "utf8" }).status, 0);

    const { id } = await mediaService.createVideoProject("Set", [{ file: sources[0] }, { file: quiet }], { layout: "separate" });
    const [spoken, silent] = store.readEditor(id).edl.media.map((m) => m.id);
    // What an import would have done, done by hand here so the order is deterministic.
    const words = await import("../../transcription/server/media");
    await words.transcribeProjectMedia(id, { mediaIds: [spoken], by: "import" });
    assert.equal(calls, 1);

    const logs: string[] = [];
    await batch.runBatch(id, { runner: planner(), onLog: (k, t) => logs.push(`${k}: ${t}`) });

    assert.equal(calls, 1, "the batch reads the cache the import wrote, it does not recognise twice");
    const after = store.readEditor(id).edl;
    assert.equal(after.media[0].transcription?.status, "done");
    assert.equal(after.media[1].transcription?.status, "skipped");
    assert.match(after.media[1].transcription!.reason, /silent|no audio track/);
    assert.ok(logs.some((l) => /not transcribed/.test(l)), logs.join("\n"));
    void silent;
  } finally { transcribe.setDefaultRecogniser(undefined); }
});
