import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Edl, Clip } from "../types";
import { applyOperations, patchFromClip, type EditorSnapshot } from "../lib/operations";
import type { AgentProvider } from "../../agent/types";
let workspace: string;
let store: typeof import("../server/store");
let database: typeof import("../../../common/server/db");
let tools: typeof import("../server/tools");
const fixture = (id = "test") => Edl.parse({ projectId: id, source: { file: path.join(workspace, "source.mp4"), width: 640, height: 360, fps: 30, durationSec: 20 }, clips: [{ id: "one", title: "Original", start: 0, end: 10, captions: { fontSizePct: 7, preset: "boxed" }, crop: [{ t: 0, x: 10, y: 0, w: 180, h: 320 }], words: [{ w: "hello", t: 2, d: 1 }], edits: [{ type: "text", t: 3, d: 2, text: "Keep me" }] }] });
before(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agentcut-editor-test-"));
  process.env.AGENTCUT_WORKSPACE = workspace;
  database = await import("../../../common/server/db");
  store = await import("../server/store");
  tools = await import("../server/tools");
});
after(async () => { database.db.close(); await fs.rm(workspace, { recursive: true, force: true }); });
async function project(id: string) {
  const edl = fixture(id);
  database.q.insertProject({ id, name: id, source_path: edl.source?.file ?? "", created_at: Date.now() });
  return store.publishClips(id, edl);
}

test("partial edits preserve omitted fields and nested caption settings", () => {
  const edl = fixture();
  const changed = applyOperations(edl, [{ type: "clip.patch", clipId: "one", patch: { title: "Changed", captions: { positionY: 0.4 } } }, { type: "output.patch", patch: { fps: 60 } }]);
  assert.equal(changed.clips[0].title, "Changed");
  assert.equal(changed.clips[0].captions.fontSizePct, 7);
  assert.equal(changed.clips[0].captions.preset, "boxed");
  assert.deepEqual(changed.clips[0].edits, edl.clips[0].edits);
  assert.deepEqual(changed.clips[0].crop, edl.clips[0].crop);
  assert.equal(changed.output.width, edl.output.width);
  assert.equal(edl.clips[0].title, "Original");
});

test("visual control adapter and agent tool produce identical state, in both handoffs", async () => {
  const start = await project("parity");
  const next = { ...start.edl.clips[0], title: "Human title" };
  const operation = patchFromClip(start.edl.clips[0], next);
  const preview = applyOperations(start.edl, [operation]);
  const saved = await tools.executeEditorTool("parity", { tool: "project.edit", expectedRevision: start.revision, operations: [operation] }) as EditorSnapshot;
  assert.deepEqual(saved.edl, preview);
  const agent = await tools.executeEditorTool("parity", { tool: "project.edit", expectedRevision: saved.revision, operations: [{ type: "edit.add", clipId: "one", edit: { type: "punch", t: 1, d: 1, scale: 1.2 } }] }) as EditorSnapshot;
  const ui = store.editProject("parity", { expectedRevision: agent.revision, operations: [patchFromClip(agent.edl.clips[0], { ...agent.edl.clips[0], title: "Human continues" })] });
  assert.equal(ui.edl.clips[0].edits.length, 2);
  assert.equal(ui.edl.clips[0].edits[1].type, "punch");
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(workspace, "projects/parity/edl.json"), "utf8")), ui.edl);
});

test("stale saves fail atomically; the newer edit survives", async () => {
  const start = await project("conflict");
  const request = { expectedRevision: start.revision, operations: [{ type: "clip.patch", clipId: "one", patch: { title: "First writer" } }] };
  const saved = store.editProject("conflict", request);
  assert.throws(() => store.editProject("conflict", request), store.RevisionConflict);
  assert.deepEqual(store.readEditor("conflict"), saved);
  assert.throws(() => store.editProject("conflict", { expectedRevision: saved.revision, operations: [{ type: "clip.patch", clipId: "one", patch: { title: "Must roll back" } }, { type: "edit.remove", clipId: "one", index: 99 }] }));
  assert.deepEqual(store.readEditor("conflict"), saved);
});

test("new selection appends clips and preserves every existing manual edit", async () => {
  const start = await project("selection");
  const proposal = fixture("selection"); proposal.clips[0].id = "two";
  const next = store.publishClips("selection", proposal);
  assert.deepEqual(next.edl.clips[0], start.edl.clips[0]);
  assert.equal(next.edl.clips.length, 2);
});

test("trimming rebases words, edit times and crop; stale callback preconditions are rejected", () => {
  const edl = fixture();
  const next = applyOperations(edl, [{ type: "clip.patch", clipId: "one", patch: { start: 2 } }]);
  assert.equal(next.clips[0].words[0].t, 0);
  assert.equal(next.clips[0].edits[0].t, 1);
  assert.equal(next.clips[0].crop[0].t, 0);
  const delayed = patchFromClip(edl.clips[0], { ...edl.clips[0], title: "Delayed" });
  const newer = applyOperations(edl, [{ type: "clip.patch", clipId: "one", patch: { title: "Newer" } }]);
  assert.throws(() => applyOperations(newer, [delayed]), /changed before/);
});

test("all edit types, crop/split, output and clip lifecycle share the operation engine", () => {
  const edl = fixture();
  const edits = [
    { type: "silence", t: 1, d: 0.5 }, { type: "punch", t: 2, d: 1, scale: 1.5 },
    { type: "emphasis", t: 2, d: 1, words: ["hello"] }, { type: "text", t: 0, d: 2, text: "Title" },
    { type: "image", t: 0, d: 3, src: "a_image" }, { type: "sfx", t: 3, d: 1, src: "a_audio" },
    { type: "music", t: 0, d: 10, src: "a_audio", gain: 0.2, duck: true, loop: true },
  ];
  const next = applyOperations(edl, [...edits.map(edit => ({ type: "edit.add", clipId: "one", edit })), { type: "clip.patch", clipId: "one", patch: { layout: { type: "split", top: { x: 0, y: 0, w: 100, h: 100 }, bottom: { x: 100, y: 0, w: 500, h: 300 }, topPct: 40 } } }, { type: "clip.add", clip: Clip.parse({ id: "two", title: "Second", start: 5, end: 10 }) }, { type: "clip.remove", clipId: "one" }]);
  assert.equal(next.clips.length, 1); assert.equal(next.clips[0].id, "two");
  assert.throws(() => applyOperations(edl, [{ type: "clip.patch", clipId: "one", patch: { start: 99 } }]));
});

test("agent file transport really calls shared tools and saves against revisions", async () => {
  const start = await project("bridge");
  const runner: AgentProvider = { id: "test", label: "Test", available: async () => true, run: async options => {
    const call = async (n: string, body: unknown) => {
      await fs.writeFile(path.join(options.cwd, `request-${n}.json`), JSON.stringify(body));
      for (let i = 0; i < 100; i++) {
        try { return JSON.parse(await fs.readFile(path.join(options.cwd, `response-${n}.json`), "utf8")); } catch { await new Promise(r => setTimeout(r, 20)); }
      }
      throw new Error("Tool response timed out");
    };
    const read = await call("0001", { tool: "project.read" }); assert.equal(read.data.revision, start.revision);
    const result = await call("0002", { tool: "project.edit", expectedRevision: read.data.revision, operations: [{ type: "clip.patch", clipId: "one", patch: { title: "Agent edited" } }] });
    assert.equal(result.ok, true);
    const conflict = await call("0003", { tool: "project.edit", expectedRevision: read.data.revision, operations: [{ type: "clip.remove", clipId: "one" }] });
    assert.equal(conflict.ok, false); assert.equal(conflict.current.revision, result.data.revision);
    return { provider: "test", text: "done", events: [], durationMs: 1 };
  } };
  const { runEditorAgent } = await import("../../agent/server/editor-agent");
  await runEditorAgent("bridge", "Change the title", { runner });
  assert.equal(store.readEditor("bridge").edl.clips[0].title, "Agent edited");
});

test("UI HTTP endpoint and agent tools reject the same invalid operations", async () => {
  const start = await project("http");
  const { PATCH } = await import("../../../app/api/projects/[id]/route");
  const invalid = { expectedRevision: start.revision, operations: [{ type: "clip.patch", clipId: "one", patch: { end: -1 } }] };
  const response = await PATCH(new Request("http://localhost/api/projects/http", { method: "PATCH", body: JSON.stringify(invalid) }) as never, { params: Promise.resolve({ id: "http" }) });
  assert.equal(response.status, 400);
  await assert.rejects(tools.executeEditorTool("http", { tool: "project.edit", ...invalid }));
  assert.deepEqual(store.readEditor("http"), start);
  // The same holds for the operations added since: a keyframe past the end of the shot
  // is refused identically through both doors, with the same sentence.
  const promoted = await tools.executeEditorTool("http", { tool: "project.edit", expectedRevision: start.revision, operations: [{ type: "clip.promote", clipId: "one" }] }) as EditorSnapshot;
  const impossible = { expectedRevision: promoted.revision, operations: [{ type: "item.keyframes", sequenceId: "one", itemId: "one", keyframes: [{ t: 99, opacity: 0 }] }] };
  const refused = await PATCH(new Request("http://localhost/api/projects/http", { method: "PATCH", body: JSON.stringify(impossible) }) as never, { params: Promise.resolve({ id: "http" }) });
  assert.equal(refused.status, 400);
  assert.match((await refused.json()).error ?? "", /past the end/);
  await assert.rejects(tools.executeEditorTool("http", { tool: "project.edit", ...impossible }), /past the end/);
  assert.deepEqual(store.readEditor("http"), promoted, "and neither door left anything behind");
  const animated = { expectedRevision: promoted.revision, operations: [{ type: "item.keyframes", sequenceId: "one", itemId: "one", keyframes: [{ t: 0, opacity: 0 }, { t: 2, opacity: 1 }] }] };
  const moved = await PATCH(new Request("http://localhost/api/projects/http", { method: "PATCH", body: JSON.stringify(animated) }) as never, { params: Promise.resolve({ id: "http" }) });
  assert.equal(moved.status, 200);
  assert.deepEqual((await moved.json()).edl, applyOperations(promoted.edl, animated.operations as never));
  // A fixed value for a field the move decides is refused through both doors too.
  const fixed = { expectedRevision: store.readEditor("http").revision, operations: [{ type: "item.place", sequenceId: "one", itemId: "one", patch: { transform: { opacity: 0.5 } } }] };
  const blocked = await PATCH(new Request("http://localhost/api/projects/http", { method: "PATCH", body: JSON.stringify(fixed) }) as never, { params: Promise.resolve({ id: "http" }) });
  assert.equal(blocked.status, 400);
  await assert.rejects(tools.executeEditorTool("http", { tool: "project.edit", ...fixed }), /animates its opacity/);

  const valid = { expectedRevision: store.readEditor("http").revision, operations: [{ type: "item.patch", sequenceId: "one", itemId: "one", patch: { title: "HTTP edit" } }] };
  const before = store.readEditor("http");
  const result = await PATCH(new Request("http://localhost/api/projects/http", { method: "PATCH", body: JSON.stringify(valid) }) as never, { params: Promise.resolve({ id: "http" }) });
  assert.equal(result.status, 200);
  assert.deepEqual((await result.json()).edl, applyOperations(before.edl, valid.operations as never));
});

test("asset upload/list/import use the same project-scoped services", async () => {
  await project("assets");
  const uploaded = await tools.executeEditorTool("assets", { tool: "assets.upload", name: "swatch.png", base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=" }) as { id: string };
  const available = await tools.executeEditorTool("assets", { tool: "assets.list", kind: "image" }) as { id: string }[];
  assert.ok(available.some(a => a.id === uploaded.id));
  await assert.rejects(tools.executeEditorTool("assets", { tool: "assets.import", file: "../../source.mp4" }));
});

test("the file server's media lookup answers from the edl column, and follows its revision", async () => {
  // A byte range must not cost a full read of the project, so the route reads the media
  // index straight out of the `edl` column and remembers it. What it must never do is
  // remember it past the revision it came from, or hand one project another's answer.
  const media = (id: string, file: string) => ({ id, name: id, file, width: 640, height: 360, fps: 30, durationSec: 20 });
  const one = Edl.parse({ ...fixture("index-one"), media: [media("m", path.join(workspace, "one.mp4"))] });
  const two = Edl.parse({ ...fixture("index-two"), media: [media("m", path.join(workspace, "two.mp4"))] });
  for (const edl of [one, two]) {
    database.q.insertProject({ id: edl.projectId, name: edl.projectId, source_path: edl.source?.file ?? "", created_at: Date.now() });
    store.publishClips(edl.projectId, edl);
  }
  assert.equal(store.mediaFile("index-one", "m"), path.join(workspace, "one.mp4"));
  assert.equal(store.mediaFile("index-two", "m"), path.join(workspace, "two.mp4"), "one project's index must not answer for another");
  assert.equal(store.mediaFile("index-one", "m"), path.join(workspace, "one.mp4"), "and switching back reads the right one again");
  assert.equal(store.mediaFile("index-one", "nothing"), null);
  assert.equal(store.mediaFile("no-such-project", "m"), null);

  // What a re-import looks like from here: the column says something else, at a new revision.
  const moved = { ...one, media: [media("m", path.join(workspace, "moved.mp4"))] };
  const row = database.q.getProject("index-one")!;
  database.db.prepare("UPDATE projects SET edl = ?, revision = ? WHERE id = ?").run(JSON.stringify(moved), row.revision + 1, "index-one");
  assert.equal(store.mediaFile("index-one", "m"), path.join(workspace, "moved.mp4"), "a remembered index must not outlive the revision it was read at");

  // Whatever the shortcut answers is what the authoritative read answers.
  for (const id of ["index-one", "index-two"]) {
    for (const entry of store.readEditor(id).edl.media) assert.equal(store.mediaFile(id, entry.id), entry.file);
  }
});
