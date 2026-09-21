import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { FFMPEG } from "../src/lib/bin";
import type { AgentProvider } from "../src/lib/agent";

let workspace: string;
let source: string;
let store: typeof import("../src/lib/editor/store");
let mediaService: typeof import("../src/lib/editor/media");
let tools: typeof import("../src/lib/editor/tools");
let database: typeof import("../src/lib/db");
let observations: typeof import("../src/lib/observations");
let authorship: typeof import("../src/lib/editor/authorship");
let conversation: typeof import("../src/lib/editor/conversation");

before(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agentcut-observations-"));
  process.env.AGENTCUT_WORKSPACE = workspace;
  [store, mediaService, tools, database, observations, authorship, conversation] = await Promise.all([
    import("../src/lib/editor/store"), import("../src/lib/editor/media"), import("../src/lib/editor/tools"), import("../src/lib/db"),
    import("../src/lib/observations"), import("../src/lib/editor/authorship"), import("../src/lib/editor/conversation"),
  ]);
  source = path.join(workspace, "source.mp4");
  const result = spawnSync(FFMPEG, ["-y", "-f", "lavfi", "-i", "color=navy:size=320x180:rate=15:duration=10",
    "-f", "lavfi", "-i", "sine=frequency=300:duration=10", "-pix_fmt", "yuv420p", "-shortest", source], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});
after(async () => { database.db.close(); await fs.rm(workspace, { recursive: true, force: true }); });

test("authorship is stamped on everything an agent creates, kept where it already exists, and readable by people", () => {
  const stamped = authorship.stampAuthor({ tool: "project.edit", expectedRevision: 1, operations: [
    { type: "item.edit.add", sequenceId: "s", itemId: "i", edit: { type: "text", t: 0, d: 2, text: "Hi", position: "top", style: "card", by: "" } },
    { type: "item.patch", sequenceId: "s", itemId: "i", patch: { edits: [{ type: "punch", t: 1, d: 1, scale: 1.1, by: "template:talking-head" }, { type: "silence", t: 2, d: 0.5, by: "" }] } },
    { type: "item.patch", sequenceId: "s", itemId: "i", patch: { title: "No edits here" } },
    { type: "item.add", sequenceId: "s", item: { id: "n", mediaId: null, clip: { id: "n", title: "T", start: 0, end: 2, edits: [{ type: "text", t: 0, d: 2, text: "x", position: "top", style: "card" }] } } },
  ] }, "agent:7") as { operations: Array<Record<string, unknown>> };
  assert.equal((stamped.operations[0].edit as { by: string }).by, "agent:7");
  const edits = (stamped.operations[1].patch as { edits: Array<{ by: string }> }).edits;
  assert.deepEqual(edits.map((e) => e.by), ["template:talking-head", "agent:7"]);
  assert.deepEqual(stamped.operations[2], { type: "item.patch", sequenceId: "s", itemId: "i", patch: { title: "No edits here" } });
  assert.equal(((stamped.operations[3].item as { clip: { edits: Array<{ by: string }> } }).clip.edits[0]).by, "agent:7");
  assert.deepEqual(authorship.stampAuthor({ tool: "project.read" }, "agent:7"), { tool: "project.read" });
  assert.equal(authorship.describeAuthor(""), "Placed by hand");
  assert.equal(authorship.describeAuthor("agent:12"), "Placed by the agent (message 12)");
  assert.equal(authorship.describeAuthor("template:talking-head/plan/rule:quiet,gameplay"), "Template talking-head, from the plan, because of rules quiet, gameplay");
  assert.equal(authorship.describeAuthor("template:explainer-broll"), "Template explainer-broll");
});

test("a person's changes to generated work are observed; an agent's are not; work from scratch is not either", async () => {
  const { id } = await mediaService.createVideoProject("Observed", [{ file: source }]);
  const start = store.readEditor(id);
  const sequenceId = start.edl.sequences[0].id;
  const itemId = start.edl.sequences[0].items[0].id;
  const generated = [
    { type: "text", t: 0, d: 2, text: "Why it matters", position: "top", style: "card", by: "template:talking-head/plan" },
    { type: "punch", t: 3, d: 1, scale: 1.1, by: "agent:3" },
    { type: "silence", t: 5, d: 0.4, by: "" },
  ];
  const seeded = store.editProject(id, { expectedRevision: start.revision, operations: [
    { type: "item.patch", sequenceId, itemId, patch: { words: [{ w: "clod", t: 0, d: 0.3 }, { w: "is", t: 0.4, d: 0.2 }, { w: "great", t: 0.7, d: 0.3 }], edits: generated } },
  ] }, { actor: "agent" });
  assert.equal(observations.readObservations().length, 0, "an agent's own edits are not corrections");

  // A person removes the punch, changes the title, fixes a caption word, and adds a brand-new title.
  const human = store.editProject(id, { expectedRevision: seeded.revision, operations: [
    { type: "item.patch", sequenceId, itemId, patch: {
      words: [{ w: "Claude", t: 0, d: 0.3 }, { w: "is", t: 0.4, d: 0.2 }, { w: "great", t: 0.7, d: 0.3 }],
      edits: [{ ...generated[0], text: "Why it really matters" }, generated[2], { type: "text", t: 6, d: 2, text: "Mine", position: "bottom", style: "plain", by: "" }],
    } },
  ] }, { actor: "human" });
  const seen = observations.readObservations();
  assert.deepEqual(seen.map((o) => o.kind).sort(), ["caption", "changed", "removed"]);
  assert.match(seen.find((o) => o.kind === "removed")!.text, /Removed the punch-in on "source.mp4" \(placed by the agent \(message 3\)\)/);
  assert.match(seen.find((o) => o.kind === "changed")!.text, /Changed the title "Why it matters"/);
  assert.match(seen.find((o) => o.kind === "caption")!.text, /clod → Claude/);
  assert.equal(seen.find((o) => o.kind === "removed")!.by, "agent:3");

  // Moving a generated layer counts; the same through the HTTP route counts; through the agent tool it does not.
  store.editProject(id, { expectedRevision: human.revision, operations: [{ type: "item.place", sequenceId, itemId, patch: { at: 1 } }] }, { actor: "human" });
  assert.equal(observations.readObservations().length, 4);
  const { PATCH } = await import("../src/app/api/projects/[id]/route");
  const res = await PATCH(new (await import("next/server")).NextRequest("http://x/api", { method: "PATCH", body: JSON.stringify({ expectedRevision: store.readEditor(id).revision, operations: [{ type: "item.patch", sequenceId, itemId, patch: { captions: { preset: "none", maxWordsPerLine: 2 } } }] }) }), { params: Promise.resolve({ id }) });
  assert.equal(res.status, 200);
  assert.equal(observations.readObservations().length, 5);
  await tools.executeEditorTool(id, { tool: "project.edit", expectedRevision: store.readEditor(id).revision, operations: [{ type: "item.patch", sequenceId, itemId, patch: { edits: [] } }] });
  assert.equal(observations.readObservations().length, 5, "the agent tool is not a person");
  const block = observations.observationsBlock(observations.readObservations());
  assert.match(block, /What the owner has corrected before/);
  assert.equal(observations.observationsBlock([]), "");
  const viaTool = await tools.executeEditorTool(id, { tool: "observations.read" }) as unknown[];
  assert.equal(viaTool.length, 5);
});

test("review is on request: an agent proposes from the bank, existing rules are filtered, and nothing is saved", async () => {
  const { id } = await mediaService.createVideoProject("Review", [{ file: source }]);
  const { saveRule, listRules } = await import("../src/lib/rules/registry");
  await saveRule({ id: "existing", name: "Existing", when: "always", then: {} });
  let files: string[] = [];
  const runner: AgentProvider = { id: "test", label: "Test", available: async () => true, run: async (o) => {
    files = await fs.readdir(o.cwd);
    const seen = JSON.parse(await fs.readFile(path.join(o.cwd, "observations.json"), "utf8")) as unknown[];
    assert.ok(seen.length >= 5);
    await fs.writeFile(path.join(o.cwd, "proposals.json"), JSON.stringify({
      rules: [{ id: "existing", name: "Dup", when: "x", then: {} }, { id: "no-punch-agent", name: "No punch-ins", when: "the agent adds punch-ins", then: { overrides: { rhythm: { punch: { enabled: false } } } } }, { id: "Bad Id", name: "x", when: "x", then: {} }],
      glossary: [{ term: "Claude", aliases: ["clod"], note: "" }],
      preferences: "Titles say why, not what.",
      notes: "two corrections of the same kind",
    }));
    return { provider: "test", text: "DONE", events: [], durationMs: 1 };
  } };
  await assert.rejects(observations.reviewObservations(id, { runner }), /Bad Id|lowercase|invalid/i);
  const gentle: AgentProvider = { ...runner, run: async (o) => {
    await runner.run(o);
    const written = JSON.parse(await fs.readFile(path.join(o.cwd, "proposals.json"), "utf8"));
    written.rules = written.rules.slice(0, 2);
    await fs.writeFile(path.join(o.cwd, "proposals.json"), JSON.stringify(written));
    return { provider: "test", text: "DONE", events: [], durationMs: 1 };
  } };
  const proposals = await observations.reviewObservations(id, { runner: gentle });
  for (const name of ["observations.json", "rules.json", "rule.schema.json", "glossary.json", "preferences.md"]) assert.ok(files.includes(name), name);
  assert.deepEqual(proposals.rules.map((r) => r.id), ["no-punch-agent"], "an existing id is not proposed again");
  assert.equal(proposals.glossary[0].term, "Claude");
  assert.equal(proposals.preferences, "Titles say why, not what.");
  assert.ok(proposals.observations >= 5);
  assert.equal((await listRules()).length, 1, "review saves nothing");
  observations.clearObservations();
  assert.equal((await observations.reviewObservations(id, { runner })).observations, 0);
});

test("an editing run stamps its message id, sees frames and the transcript of the open video, and the observations", async () => {
  const { id } = await mediaService.createVideoProject("Sees", [{ file: source }]);
  const { edl } = store.readEditor(id);
  const sequenceId = edl.sequences[0].id;
  const itemId = edl.sequences[0].items[0].id;
  observations.recordObservation({ projectId: id, sequenceId, kind: "removed", text: "Removed a picture the agent placed", by: "agent:1" });
  let files: string[] = [];
  let frames: string[] = [];
  let prompt = "";
  const runner: AgentProvider = { id: "test", label: "Test", available: async () => true, run: async (o) => {
    files = await fs.readdir(o.cwd);
    frames = await fs.readdir(path.join(o.cwd, "frames")).catch(() => []);
    prompt = o.prompt;
    const call = async (n: string, body: unknown) => {
      await fs.writeFile(path.join(o.cwd, `request-${n}.json`), JSON.stringify(body));
      for (let i = 0; i < 100; i++) { try { return JSON.parse(await fs.readFile(path.join(o.cwd, `response-${n}.json`), "utf8")); } catch { await new Promise((r) => setTimeout(r, 20)); } }
      throw new Error("timeout");
    };
    const read = await call("0001", { tool: "project.read" });
    await call("0002", { tool: "project.edit", expectedRevision: read.data.revision, operations: [{ type: "item.edit.add", sequenceId, itemId, edit: { type: "text", t: 0, d: 2, text: "Agent title", position: "top", style: "card" } }] });
    return { provider: "test", text: "Added a title.", events: [], durationMs: 1 };
  } };
  const { sent } = await conversation.sendMessage(id, "Add a title", { runner, sequenceId });
  assert.ok(files.includes("transcript.txt") && files.includes("signals.json") && files.includes("observations.md"), files.join(","));
  assert.ok(frames.length >= 3, `frames sampled: ${frames.length}`);
  assert.match(frames[0], /^frame-\d+\.\d\.jpg$/);
  assert.match(prompt, /frames\/ holds \d+ sampled frames/);
  assert.match(prompt, /Removed a picture the agent placed/);
  const edit = store.readEditor(id).edl.sequences[0].items[0].clip.edits.at(-1)!;
  assert.equal(edit.by, `agent:${sent.id}`);
});
