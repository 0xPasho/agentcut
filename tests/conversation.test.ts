import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { PassThrough } from "node:stream";
import type { AgentProvider } from "../src/lib/agent";

let workspace: string;
let store: typeof import("../src/lib/editor/store");
let database: typeof import("../src/lib/db");
let tools: typeof import("../src/lib/editor/tools");
let conversation: typeof import("../src/lib/editor/conversation");
let mcp: typeof import("../src/lib/mcp");
import { sequenceFrames } from "../src/lib/sequences";

before(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agentcut-conversation-"));
  process.env.AGENTCUT_WORKSPACE = workspace;
  [store, database, tools, conversation, mcp] = await Promise.all([
    import("../src/lib/editor/store"), import("../src/lib/db"), import("../src/lib/editor/tools"), import("../src/lib/editor/conversation"), import("../src/lib/mcp"),
  ]);
});
after(async () => { database.db.close(); await fs.rm(workspace, { recursive: true, force: true }); });

async function project(id: string) {
  database.q.insertProject({ id, name: id, source_path: "/tmp/none.mp4", created_at: Date.now() });
  return store.publishClips(id, { version: 1, projectId: id, source: { file: "/tmp/none.mp4", width: 1920, height: 1080, fps: 30, durationSec: 60 }, output: { width: 1080, height: 1920, fps: 30 }, clips: [{ id: "one", title: "First", start: 0, end: 10, crop: [], layout: { type: "crop" }, captions: {}, words: [], edits: [], hook: "", reason: "", score: 50, tags: [] }], media: [], sequences: [], plan: {} } as never);
}

test("a message runs the agent with the thread and the editor's context behind it, and records the reply", async () => {
  await project("thread");
  conversation.recordMessage("thread", { role: "user", source: "brief", text: "Clips about ranking for TikTok" });
  let seen: { history: Array<{ role: string; text: string }>; context: Record<string, unknown>; prompt: string } | null = null;
  const runner: AgentProvider = { id: "test", label: "Test", available: async () => true, run: async (o) => {
    seen = {
      history: JSON.parse(await fs.readFile(path.join(o.cwd, "conversation.json"), "utf8")),
      context: JSON.parse(await fs.readFile(path.join(o.cwd, "context.json"), "utf8")),
      prompt: o.prompt,
    };
    return { provider: "test", text: "Moved the title.", events: [], durationMs: 1 };
  } };
  const { sent, reply } = await conversation.sendMessage("thread", "Move the title down", { runner, source: "cli", context: { sequenceId: "one", selection: ["i_1"], playhead: 3.5 } });
  assert.equal(sent.role, "user"); assert.equal(sent.source, "cli"); assert.equal(sent.sequenceId, "one");
  assert.equal(reply.role, "agent"); assert.equal(reply.text, "Moved the title.");
  assert.deepEqual(seen!.history.map((h) => h.text), ["Clips about ranking for TikTok"], "earlier turns, not the one being sent");
  assert.equal(seen!.context.sequenceId, "one");
  assert.match(seen!.prompt, /selected timeline item i_1/);
  assert.match(seen!.prompt, /playhead is at 3\.50s/);
  assert.match(seen!.prompt, /conversation\.json holds the earlier turns/);

  const thread = await tools.executeEditorTool("thread", { tool: "conversation.read" }) as Array<{ role: string; source: string; text: string }>;
  assert.deepEqual(thread.map((m) => [m.role, m.source]), [["user", "brief"], ["user", "cli"], ["agent", "agent"]]);

  // A failing run still leaves a turn in the thread, so the human sees what happened.
  const broken: AgentProvider = { ...runner, run: async () => { throw new Error("no CLI"); } };
  await assert.rejects(conversation.sendMessage("thread", "Again", { runner: broken }), /no CLI/);
  const last = conversation.readConversation("thread").at(-1)!;
  assert.equal(last.role, "agent"); assert.match(last.text, /Failed: no CLI/);
  assert.throws(() => conversation.recordMessage("nope", { role: "user", source: "web", text: "x" }), /Project not found/);
});

test("history is trimmed from the oldest so a long thread never crowds out the material", async () => {
  await project("long");
  for (let i = 0; i < 40; i++) conversation.recordMessage("long", { role: i % 2 ? "agent" : "user", source: "web", text: `turn ${i} ${"x".repeat(500)}` });
  const history = conversation.historyFor("long");
  assert.ok(history.length < 40 && history.length >= 20, `kept ${history.length}`);
  assert.match(history.at(-1)!.text, /^turn 39/);
  assert.ok(history.reduce((n, h) => n + h.text.length, 0) <= 12_000);
});

test("the MCP server exposes every editor tool from the same schema, and calls go through the same execution", async () => {
  const start = await project("mcp");
  const listed = mcp.listMcpTools();
  const editorTools = tools.editorToolSchema() as { anyOf?: unknown[]; oneOf?: unknown[] };
  const variants = (editorTools.anyOf ?? editorTools.oneOf ?? []).length;
  assert.equal(listed.length, variants + 3, "one MCP tool per editor tool, plus projects and the conversation");
  const edit = listed.find((t) => t.name === "agentcut_project_edit")!;
  assert.deepEqual(edit.inputSchema.required, ["projectId", "expectedRevision", "operations"]);
  assert.ok(!("tool" in (edit.inputSchema.properties as object)), "the discriminator is not a parameter");

  const init = await mcp.handleMcpRequest({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }, "1.0") as { protocolVersion: string; capabilities: { tools: object } };
  assert.equal(typeof init.protocolVersion, "string"); assert.ok(init.capabilities.tools);
  assert.equal(await mcp.handleMcpRequest({ jsonrpc: "2.0", method: "notifications/initialized" }, "1.0"), undefined);

  const read = await mcp.handleMcpRequest({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "agentcut_project_read", arguments: { projectId: "mcp" } } }, "1.0") as { content: Array<{ text: string }>; isError?: boolean };
  assert.ok(!read.isError);
  assert.equal(JSON.parse(read.content[0].text).revision, start.revision);

  const edited = await mcp.handleMcpRequest({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "agentcut_project_edit", arguments: { projectId: "mcp", expectedRevision: start.revision, operations: [{ type: "clip.patch", clipId: "one", patch: { title: "From the terminal" } }] } } }, "1.0") as { isError?: boolean };
  assert.ok(!edited.isError);
  assert.equal(store.readEditor("mcp").edl.clips[0].title, "From the terminal");

  const stale = await mcp.handleMcpRequest({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "agentcut_project_edit", arguments: { projectId: "mcp", expectedRevision: start.revision, operations: [{ type: "clip.remove", clipId: "one" }] } } }, "1.0") as { content: Array<{ text: string }>; isError?: boolean };
  assert.equal(stale.isError, true);
  assert.equal(JSON.parse(stale.content[0].text).current.revision, start.revision + 1, "a conflict reports the current revision like HTTP does");

  const noted = await mcp.handleMcpRequest({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "agentcut_message_record", arguments: { projectId: "mcp", text: "Renamed the first clip." } } }, "1.0") as { isError?: boolean };
  assert.ok(!noted.isError);
  const thread = conversation.readConversation("mcp");
  assert.deepEqual(thread.map((m) => [m.role, m.source, m.text]), [["agent", "mcp", "Renamed the first clip."]]);
  const projects = await mcp.handleMcpRequest({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "agentcut_projects_list", arguments: {} } }, "1.0") as { content: Array<{ text: string }> };
  assert.ok((JSON.parse(projects.content[0].text) as Array<{ id: string }>).some((p) => p.id === "mcp"));
  await assert.rejects(mcp.handleMcpRequest({ jsonrpc: "2.0", id: 7, method: "nope" }, "1.0"), /Method not found/);
});

test("over the wire it is newline-delimited JSON-RPC and nothing else reaches stdout", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const chunks: string[] = [];
  output.on("data", (c) => chunks.push(String(c)));
  const served = mcp.serveMcp(input, output, "1.0");
  input.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }) + "\n");
  input.write("not json\n");
  input.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  input.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }) + "\n");
  await new Promise((r) => setTimeout(r, 200));
  input.end();
  await served;
  const replies = chunks.join("").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  assert.deepEqual(replies.map((r) => r.id), [1, null, 2]);
  assert.equal(replies[1].error.code, -32700);
  assert.ok(replies[2].result.tools.length > 30);
});

test("an agent turn's changes are recorded and can be taken back as one edit, until something else changes", async () => {
  const start = await project("undo");
  const runner: AgentProvider = { id: "test", label: "Test", available: async () => true, run: async (o) => {
    const call = async (n: string, body: unknown) => {
      await fs.writeFile(path.join(o.cwd, `request-${n}.json`), JSON.stringify(body));
      for (let i = 0; i < 100; i++) { try { return JSON.parse(await fs.readFile(path.join(o.cwd, `response-${n}.json`), "utf8")); } catch { await new Promise((r) => setTimeout(r, 20)); } }
      throw new Error("timeout");
    };
    const read = await call("0001", { tool: "project.read" });
    const one = await call("0002", { tool: "project.edit", expectedRevision: read.data.revision, operations: [{ type: "clip.patch", clipId: "one", patch: { title: "Renamed by agent" } }] });
    await call("0003", { tool: "project.edit", expectedRevision: one.data.revision, operations: [{ type: "edit.add", clipId: "one", edit: { type: "text", t: 0, d: 2, text: "Agent title", position: "top", style: "card" } }] });
    return { provider: "test", text: "Renamed and titled.", events: [], durationMs: 1 };
  } };
  const { reply } = await conversation.sendMessage("undo", "Rename it and add a title", { runner, media: false } as never);
  assert.deepEqual(reply.changes, { revisionBefore: start.revision, revisionAfter: start.revision + 2, operations: 2, undone: false });
  let edl = store.readEditor("undo").edl;
  assert.equal(edl.clips[0].title, "Renamed by agent");
  assert.equal(edl.clips[0].edits.length, 1);

  // A later edit blocks the undo until it is dealt with; then the whole turn comes back as one edit.
  const later = store.editProject("undo", { expectedRevision: start.revision + 2, operations: [{ type: "clip.patch", clipId: "one", patch: { hook: "later" } }] });
  await assert.rejects(conversation.undoMessage("undo", reply.id), /Undo the later changes first/);
  store.editProject("undo", { expectedRevision: later.revision, operations: [{ type: "clip.patch", clipId: "one", patch: { hook: "" } }] });
  await assert.rejects(conversation.undoMessage("undo", reply.id), /changed since/);
  // Bring the revision back to where the turn ended: not possible in general, so this is the escape hatch — check the message directly.
  const row = database.q.getMessage(reply.id)!;
  database.q.setMessageChanges(reply.id, JSON.stringify({ ...JSON.parse(row.changes!), revisionAfter: store.readEditor("undo").revision }));
  const undone = await tools.executeEditorTool("undo", { tool: "conversation.undo", messageId: reply.id }) as { reverted: number };
  assert.equal(undone.reverted, 2);
  edl = store.readEditor("undo").edl;
  assert.equal(edl.clips[0].title, "First");
  assert.equal(edl.clips[0].edits.length, 0);
  const thread = conversation.readConversation("undo");
  assert.equal(thread.find((m) => m.id === reply.id)!.changes!.undone, true);
  assert.match(thread.at(-1)!.text, /Undid the agent's changes/);
  await assert.rejects(conversation.undoMessage("undo", reply.id), /already been undone/);
  await assert.rejects(conversation.undoMessage("undo", 999999), /Message not found/);
});

test("a terminal agent sets a transition over MCP, with the same contract and the same refusal as the UI", async () => {
  const id = "mcp-joint";
  database.q.insertProject({ id, name: id, source_path: "", created_at: Date.now() });
  const shot = (name: string) => ({ id: name, mediaId: null, clip: { id: name, title: name, start: 0, end: 2, crop: [], layout: { type: "crop" }, captions: {}, words: [], edits: [], hook: "", reason: "", score: 50, tags: [] } });
  const start = store.publishClips(id, { version: 1, projectId: id, source: null, output: { width: 640, height: 360, fps: 10 }, clips: [], media: [],
    sequences: [{ id: "s", title: "Two shots", output: { width: 640, height: 360, fps: 10 }, items: [shot("a"), shot("b")], plan: {} }], plan: {} } as never);
  const edit = mcp.listMcpTools().find((t) => t.name === "agentcut_project_edit")!;
  assert.ok(JSON.stringify(edit.inputSchema).includes("item.transition"), "the joint is part of the published tool contract, not a private operation");
  const call = (operations: unknown[], expectedRevision: number) => mcp.handleMcpRequest({ jsonrpc: "2.0", id: 11, method: "tools/call",
    params: { name: "agentcut_project_edit", arguments: { projectId: id, expectedRevision, operations } } }, "1.0") as Promise<{ content: Array<{ text: string }>; isError?: boolean }>;
  const set = await call([{ type: "item.transition", sequenceId: "s", itemId: "b", transition: { kind: "slide", durationSec: 0.5, direction: "up" } }], start.revision);
  assert.ok(!set.isError, set.content?.[0]?.text);
  const saved = store.readEditor(id).edl.sequences[0];
  assert.equal(saved.items[1].transition!.kind, "slide");
  assert.equal(sequenceFrames(saved).duration, 35, "the programme is shorter by exactly what the joint takes");
  // The first shot on a track has nothing to arrive over, through this transport too.
  const refused = await call([{ type: "item.transition", sequenceId: "s", itemId: "a", transition: { kind: "dissolve", durationSec: 0.5 } }], store.readEditor(id).revision);
  assert.equal(refused.isError, true);
  assert.match(refused.content[0].text, /first shot on its track/);
});
