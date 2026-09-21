import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { AgentEvent, AgentProvider } from "../src/lib/agent";

/**
 * A run that says nothing until it is finished is a spinner, not feedback. These
 * cover the one trail every interface reads: the web panel over SSE, a terminal
 * agent over MCP progress and `project.status`, and the CLI on stderr.
 */

let workspace: string;
let store: typeof import("../src/lib/editor/store");
let database: typeof import("../src/lib/db");
let tools: typeof import("../src/lib/editor/tools");
let conversation: typeof import("../src/lib/editor/conversation");
let mcp: typeof import("../src/lib/mcp");
let activity: typeof import("../src/lib/activity");
let activityLog: typeof import("../src/lib/activity-log");

before(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agentcut-activity-"));
  process.env.AGENTCUT_WORKSPACE = workspace;
  [store, database, tools, conversation, mcp, activity, activityLog] = await Promise.all([
    import("../src/lib/editor/store"), import("../src/lib/db"), import("../src/lib/editor/tools"),
    import("../src/lib/editor/conversation"), import("../src/lib/mcp"), import("../src/lib/activity"), import("../src/lib/activity-log"),
  ]);
});
after(async () => { database.db.close(); await fs.rm(workspace, { recursive: true, force: true }); });

async function project(id: string) {
  database.q.insertProject({ id, name: id, source_path: "/tmp/none.mp4", created_at: Date.now() });
  return store.publishClips(id, { version: 1, projectId: id, source: { file: "/tmp/none.mp4", width: 1920, height: 1080, fps: 30, durationSec: 60 }, output: { width: 1080, height: 1920, fps: 30 }, clips: [{ id: "one", title: "First", start: 0, end: 10, crop: [], layout: { type: "crop" }, captions: {}, words: [], edits: [], hook: "", reason: "", score: 50, tags: [] }], media: [], sequences: [], plan: {} } as never);
}

test("a tool call is described in words, not dumped as JSON", () => {
  const edit = activity.describeToolCall({ tool: "project.edit", expectedRevision: 3, operations: [{ type: "clip.patch", clipId: "one", patch: { title: "x" } }] });
  assert.equal(edit.name, "project.edit");
  assert.equal(edit.text, "clip.patch one", "a single change names what it touched");

  const many = activity.describeToolCall({ tool: "project.edit", operations: [{ type: "item.patch" }, { type: "item.patch" }, { type: "item.place" }] });
  assert.equal(many.text, "3 changes · item.patch ×2, item.place");

  assert.equal(activity.describeToolCall({ tool: "assets.search", query: "server rack" }).text, "server rack");
  assert.match(activity.describeToolCall({ tool: "template.apply", templateId: "explainer", sequenceId: "one", expectedRevision: 1 }).text, /^explainer on one$/);
  assert.equal(activity.describeToolCall({ tool: "project.read" }).text, "reading the project");
  // Nothing is ever the raw payload: a base64 upload would otherwise print megabytes.
  assert.ok(!activity.describeToolCall({ tool: "assets.upload", name: "logo.png", base64: "A".repeat(5000) }).text.includes("AAAA"));
  assert.ok(activity.describeToolCall({ tool: "project.edit", operations: [] }).text.length < 60);
});

test("a harness tool call keeps the part that differs: its arguments, and paths relative to the run", () => {
  const cwd = "/tmp/agentcut/projects/p1/editor-runs/abcd";
  const grep = activity.describeAgentToolInput({ pattern: '"words": \\[', path: `${cwd}/project.json`, output_mode: "content", "-n": true }, cwd);
  assert.ok(grep.startsWith(JSON.stringify('"words": \\[')), "the pattern comes first, quoted, so its spaces and brackets survive");
  assert.match(grep, /path=project\.json/, "a path under the run directory is shown relative to it");
  assert.match(grep, /output_mode=content/);
  assert.match(grep, /-n=true/);

  assert.equal(activity.describeAgentToolInput({ file_path: `${cwd}/frames/frame-12.4.jpg` }, cwd), "frames/frame-12.4.jpg");
  assert.equal(activity.describeAgentToolInput({ file_path: "/etc/hosts" }, cwd), "/etc/hosts", "a path outside the run stays absolute");
  // Bulk is measured, never printed: a Write would otherwise put a whole file in the feed.
  assert.equal(activity.describeAgentToolInput({ file_path: `${cwd}/request-0001.json`, content: "x".repeat(9000) }, cwd), "request-0001.json content=9000 chars");
  assert.ok(activity.describeAgentToolInput({ command: "y".repeat(5000) }).length <= 1000);
  assert.equal(activity.describeAgentToolInput("not an object"), "");
});

test("the editing agent announces each tool before it runs, and how it went after", async () => {
  await project("feed");
  const events: AgentEvent[] = [];
  const runner: AgentProvider = { id: "test", label: "Test", available: async () => true, run: async (o) => {
    const call = async (n: string, body: unknown) => {
      await fs.writeFile(path.join(o.cwd, `request-${n}.json`), JSON.stringify(body));
      for (let i = 0; i < 100; i++) { try { return JSON.parse(await fs.readFile(path.join(o.cwd, `response-${n}.json`), "utf8")); } catch { await new Promise((r) => setTimeout(r, 20)); } }
      throw new Error("timeout");
    };
    const read = await call("0001", { tool: "project.read" });
    await call("0002", { tool: "project.edit", expectedRevision: read.data.revision, operations: [{ type: "clip.patch", clipId: "one", patch: { title: "Renamed" } }] });
    await call("0003", { tool: "project.edit", expectedRevision: 0, operations: [{ type: "clip.patch", clipId: "one", patch: { title: "Stale" } }] });
    return { provider: "test", text: "Renamed it.", events: [], durationMs: 1 };
  } };
  await conversation.sendMessage("feed", "Rename the first clip", { runner, media: false, onEvent: (e: AgentEvent) => events.push(e) } as never);

  const toolCalls = events.filter((e) => e.kind === "tool");
  assert.deepEqual(toolCalls.map((e) => e.name), ["project.read", "project.edit", "project.edit"]);
  assert.equal(toolCalls[1].text, "clip.patch one");
  const failure = events.find((e) => e.kind === "error");
  assert.match(failure!.text, /changed elsewhere/i, "a rejected edit says why, under the tool that failed");
  assert.equal(failure!.name, "project.edit");
  assert.ok(events.some((e) => e.kind === "log" && /revision \d+/.test(e.text)), "a successful edit reports the revision it produced");
});

test("project.status gives a waiting caller the job and everything logged since their cursor", async () => {
  await project("status");
  const first = await tools.executeEditorTool("status", { tool: "project.status" }) as { activity: Array<{ name: string | null }>; cursor: number; working: boolean; job: unknown; revision: number };
  assert.deepEqual(first.activity.map((e) => e.name), ["revision"], "only the save the project started with");
  assert.equal(first.working, false);
  assert.equal(first.job, null);
  assert.equal(first.revision, store.readEditor("status").revision);

  activityLog.recordActivity("status", { kind: "stage", text: "transcribe" }, "web");
  activityLog.recordActivity("status", { kind: "tool", name: "template.apply", text: "explainer on one" }, "web");
  const seen = await tools.executeEditorTool("status", { tool: "project.status", since: first.cursor }) as { activity: Array<{ kind: string; text: string }>; cursor: number };
  assert.deepEqual(seen.activity.map((e) => e.text), ["transcribe", "explainer on one"]);

  activityLog.recordActivity("status", { kind: "stage", text: "render complete" }, "web");
  const fresh = await tools.executeEditorTool("status", { tool: "project.status", since: seen.cursor }) as { activity: Array<{ text: string }>; cursor: number };
  assert.deepEqual(fresh.activity.map((e) => e.text), ["render complete"], "the cursor returns only what is new");
  assert.ok(fresh.cursor > seen.cursor);
  await assert.rejects(tools.executeEditorTool("gone", { tool: "project.status" }), /Project not found/);
});

test("whoever drives the editor writes to the same feed, and polling for status does not", async () => {
  const start = await project("shared");
  await mcp.handleMcpRequest({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "agentcut_project_edit", arguments: { projectId: "shared", expectedRevision: start.revision, operations: [{ type: "clip.patch", clipId: "one", patch: { title: "From the terminal" } }] } } }, "1.0");
  await mcp.handleMcpRequest({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "agentcut_project_status", arguments: { projectId: "shared" } } }, "1.0");
  await mcp.handleMcpRequest({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "agentcut_project_read", arguments: { projectId: "shared" } } }, "1.0");

  const feed = database.q.eventsSince("shared", 0).filter((e) => e.name?.startsWith("mcp:"));
  assert.deepEqual(feed.map((e) => [e.name, e.text]), [["mcp:project.edit", "clip.patch one"], ["mcp:project.edit", "revision 2"]],
    "a terminal edit shows in the web's feed");
  assert.ok(!database.q.eventsSince("shared", 0).some((e) => /project\.(read|status)/.test(e.name ?? "")), "reads and status polls stay out of the feed");

  const failed = await mcp.handleMcpRequest({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "agentcut_project_edit", arguments: { projectId: "shared", expectedRevision: start.revision, operations: [{ type: "clip.remove", clipId: "one" }] } } }, "1.0") as { isError?: boolean };
  assert.equal(failed.isError, true);
  assert.ok(database.q.eventsSince("shared", 0).some((e) => e.kind === "error"), "a failure is part of the account too");
});

test("a client that asks for progress is told what is happening while the call runs", async () => {
  const start = await project("progress");
  const notes: Array<{ method: string; params: Record<string, unknown> }> = [];
  await mcp.handleMcpRequest(
    { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "agentcut_project_edit", _meta: { progressToken: "t1" }, arguments: { projectId: "progress", expectedRevision: start.revision, operations: [{ type: "clip.patch", clipId: "one", patch: { title: "Watched" } }] } } },
    "1.0",
    (method, params) => notes.push({ method, params }),
  );
  assert.ok(notes.length >= 1);
  assert.equal(notes[0].method, "notifications/progress");
  assert.equal(notes[0].params.progressToken, "t1");
  assert.match(String(notes[0].params.message), /clip\.patch one/);
  assert.ok(Number(notes.at(-1)!.params.progress) >= Number(notes[0].params.progress), "progress only moves forward");

  // Without a token the call still works; it just has nowhere to report to.
  notes.length = 0;
  await mcp.handleMcpRequest({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "agentcut_project_read", arguments: { projectId: "progress" } } }, "1.0", (method, params) => notes.push({ method, params }));
  assert.equal(notes.length, 0);
});

test("the thread reads as one conversation: what was asked, the steps that answered it, the reply", async () => {
  const { buildThread } = await import("../src/lib/thread");
  const message = (id: number, role: "user" | "agent", at: number) =>
    ({ id, role, source: role === "user" ? "web" : "agent", text: `m${id}`, sequenceId: null, context: null, jobId: null, at, changes: null }) as never;
  const event = (id: number, at: number, jobId: string | null) =>
    ({ id, kind: "tool", name: "project.edit", text: `e${id}`, at, jobId });

  const t0 = Date.parse("2026-09-20T20:00:00Z");
  const items = buildThread(
    [message(1, "user", t0 + 1_000), message(2, "agent", t0 + 40_000)],
    [
      event(1, t0, "job-a"), event(2, t0 + 500, "job-a"),          // an earlier run, before anything was asked
      event(3, t0 + 5_000, "job-b"), event(4, t0 + 6_000, "job-b"), // the steps of this turn
    ],
  );

  assert.deepEqual(items.map((i) => i.kind), ["steps", "message", "steps", "message"], "steps sit inside the turn they belong to");
  assert.deepEqual(items.flatMap((i) => (i.kind === "steps" ? [i.events.map((e) => e.text)] : [])), [["e1", "e2"], ["e3", "e4"]],
    "a different job is a different group, even a second apart");

  // The same run with a long quiet stretch is still one run; two runs hours apart are not.
  const far = buildThread([], [event(1, t0, null), event(2, t0 + 4 * 60_000, null)]);
  assert.equal(far.length, 2, "four minutes of silence ends a group, so a day of history is not one 19-hour step list");
  const near = buildThread([], [event(1, t0, null), event(2, t0 + 30_000, null)]);
  assert.equal(near.length, 1);
});

test("the chat is an entry point: a message, a dropped video and a link each start a project their own way", async () => {
  const { readStart, nameFromMessage } = await import("../src/lib/use-chat");
  const image = { id: "a_img", name: "reference.png", kind: "image" as const };
  const video = { id: "a_vid", name: "stream.mp4", kind: "video" as const };

  assert.equal(readStart("Make a 30s explainer about pricing", []).kind, "canvas", "words alone start an empty project");
  assert.equal(readStart("Make it snappy", [image]).kind, "canvas", "a reference picture is not footage");
  assert.deepEqual(readStart("Cut this down", [video, image]).videos, [video], "dropped footage is imported, the picture rides along");
  const link = readStart("Find the best clips in https://youtu.be/abc please", [video]);
  assert.equal(link.kind, "link");
  assert.equal(link.link, "https://youtu.be/abc", "a link wins: clipping is what it asks for");

  assert.equal(nameFromMessage("Make a 30s explainer about pricing\nand keep it calm"), "Make a 30s explainer about pricing");
  assert.ok(nameFromMessage("x".repeat(200)).length <= 60);
  assert.equal(nameFromMessage("   "), "Untitled project");
});

test("an attached image is put where the run can look at it, and named by its asset id", async () => {
  await project("attached");
  const { uploadLibraryAsset } = await import("../src/lib/assets");
  // A one-pixel PNG: enough to be a real file on disk with a real asset row.
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  const asset = await uploadLibraryAsset("reference.png", new Uint8Array(png));

  let runDir = "";
  const runner = { id: "test", label: "Test", available: async () => true, run: async (o: { cwd: string; prompt: string }) => {
    runDir = o.cwd;
    seenPrompt = o.prompt;
    return { provider: "test", text: "Looked at it.", events: [], durationMs: 1 };
  } };
  let seenPrompt = "";
  await conversation.sendMessage("attached", "Match this look", {
    runner: runner as never, media: false,
    context: { attachments: [{ id: asset.id, name: "reference.png", kind: "image" }] },
  } as never);

  const copied = await fs.readdir(path.join(runDir, "attachments"));
  assert.equal(copied.length, 1, "the file is in the run directory, so the agent can open it");
  assert.match(seenPrompt, /attachments\//, "the prompt says where it is");
  assert.match(seenPrompt, new RegExp(`asset id ${asset.id}`), "and what to call it when placing it");

  // The turn keeps what was attached, so the thread can show it later.
  const turn = conversation.readConversation("attached")[0];
  assert.deepEqual(turn.context?.attachments, [{ id: asset.id, name: "reference.png", kind: "image" }]);
});
