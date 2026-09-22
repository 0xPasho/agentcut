import { createInterface } from "node:readline";
import { z } from "zod";
import { q } from "./db";
import { EditorToolCall } from "./editor/tools";
import { RevisionConflict } from "./editor/store";
import { recordMessage, sendMessage } from "./editor/conversation";
import { formatActivity } from "./activity";
import { recordActivity, runReportedTool } from "./activity-log";

/**
 * The editor as an MCP server, so a coding agent in the owner's terminal — Claude
 * Code, Codex, OpenCode — drives a project with the same tools the web panel and the
 * host-launched agent use. One MCP tool per editor tool, generated from the same
 * schema, plus the project list and the conversation. Stdio, newline-delimited
 * JSON-RPC, no dependencies: nothing here may write to stdout except replies.
 */

const PROTOCOL = "2024-11-05";

const DESCRIPTIONS: Record<string, string> = {
  "project.read": "Read the project's current EDL and revision (clips, media, sequences, plans).",
  "project.status": "What the project is doing right now: its status, the running job with its stage and progress, and every activity line logged since `since`. Poll it while a job or an edit runs and relay the new lines to the human — it is the only way they see progress. Pass the returned `cursor` back as `since` for just what is new.",
  "project.edit": "Apply editing operations against expectedRevision. Same operations as the UI.",
  "project.render": "Render the current revision to mp4.",
  "project.unlock": "Release the project when a job is stuck. Reaps a job whose process died; otherwise abandons the live one so editing is possible again.",
  "media.import": "Copy a local video into the project.",
  "media.upload": "Add a video from base64 bytes.",
  "transcript.resync": "Re-recognise the source audio and refresh caption words.",
  "assets.list": "Library and project assets of a kind.",
  "assets.search": "Search online image providers.",
  "assets.adopt": "Import a search hit into the project.",
  "assets.capture": "Capture a still from source footage as an asset.",
  "assets.browseLocal": "List a local folder.",
  "assets.importLocal": "Import a local image or sound.",
  "assets.importFolder": "Import every image or sound in a folder.",
  "assets.import": "Register a file already inside the project workspace.",
  "assets.upload": "Add an image or sound from base64 bytes.",
  "assets.providers": "Which image providers this machine has.",
  "templates.list": "Every template with its settings.",
  "templates.get": "One template.",
  "templates.schema": "The template document schema.",
  "templates.save": "Create or replace a user template, or save a variation.",
  "templates.delete": "Delete a user template.",
  "templates.suggest": "Rank templates against a video's material, with reasons.",
  "templates.looks": "Named caption looks a template or override can name.",
  "templates.preview": "A schematic SVG of a template's layout for an aspect.",
  "sequence.derive": "Copy a video into another aspect (9:16, 4:5, 1:1, 16:9) as an editable sequence linked to its original.",
  "template.plan": "Dry run of a template on a video.",
  "template.apply": "Apply a template through the shared operations.",
  "chat.source": "Where the stream's chat database is read from (setting, CHAT_DB_PATH, or the unified chat's default).",
  "chat.setSource": "Point the workspace at the stream chat's chat.db; an empty path clears it.",
  "comments.list": "The chat messages around a stream video, ranked by how much of each the streamer reads out, and the comment it opens on now.",
  "comments.place": "Open a video on a chat comment by its id — drawn as the chat drew it, the hook waiting for it — or commentId \"none\" to remove it.",
  "rules.list": "Rules that apply to this project, with level and resolved prompt text.",
  "rules.get": "One rule.",
  "rules.schema": "The rule document schema.",
  "rules.save": "Create or replace a rule at workspace or project level.",
  "rules.delete": "Delete a rule.",
  "rules.evaluate": "Have an agent judge which rules hold for a video.",
  "rules.apply": "Execute rule ids on a video as a template application.",
  "plan.read": "The project plan and every sequence plan.",
  "plan.generate": "Have an agent write a sequence plan or the shared project plan.",
  "plan.apply": "Execute a plan as a template application; all:true for every video.",
  "conversation.read": "The project's conversation, oldest first.",
  "conversation.undo": "Take back everything one agent turn did, as one edit.",
  "packs.list": "Installed packs and what each brought.",
  "packs.inspect": "Read a pack (path or URL) without installing: templates, rules with their text, assets, quick actions.",
  "packs.import": "Install a pack into the workspace; existing ids are kept unless replace is true.",
  "packs.remove": "Remove a pack's templates and rules. Assets stay.",
  "packs.export": "Write a pack folder from this workspace's templates, rules, glossary and assets.",
  "quickactions.list": "Quick actions installed packs contribute.",
  "observations.read": "What the owner has corrected: the observation bank, newest last.",
  "observations.review": "Have an agent propose rules, glossary entries and preferences from the observation bank. Nothing is saved.",
  "media.transcribe": "Transcribe imported media and put the words on every shot cut from it. background:true queues it and returns at once; force ignores both the cached transcript and the skip rules.",
  "media.transcription": "Where every source's words stand — done, still running, waiting, failed with its reason, or skipped with its reason — and the setting that decides whether a newly imported source transcribes itself.",
  "media.transcription.set": "Whether newly imported sources transcribe themselves: audio (only when the file has sound), always, or off. mode:null inherits.",
  "project.batch": "Start the batch: transcribe, plan and edit every pending video under the shared plan. Returns a job.",
  "glossary.get": "Names and how they are spelled.",
  "glossary.save": "Write the glossary at a level.",
  "preferences.get": "The owner's preferences, both levels.",
  "preferences.set": "Write preferences at a level.",
  "onboarding.status": "Whether the owner has done the setup interview, the answers so far, and the next question to ask. Ask them one at a time in conversation; never block work on them.",
  "onboarding.answer": "Save answers to setup questions as they are given, without finishing.",
  "onboarding.run": "Finish the interview: turn the answers into the owner's preferences and glossary.",
  "onboarding.skip": "The owner does not want to answer. Stop asking; the interview stays available in settings.",
  "onboarding.reopen": "Put the interview back in front of the owner, with the answers they already gave.",
  "agents.status": "Which agent CLIs this machine has, which models each offers, and which harness and model runs each kind of work.",
  "agents.select": "Choose the harness and model for the workspace, for this project, or for one kind of work (clipping, planning, editing, judging, observations). An empty provider clears the choice so it inherits again.",
  "providerkeys.list": "Which optional provider keys are set and whether the value came from settings or the environment. Never returns a key.",
  "providerkeys.set": "Save or clear a provider key. Write-only: nothing can read it back. An empty value clears it.",
};

export const mcpToolName = (tool: string) => `agentcut_${tool.replace(/\./g, "_")}`;

type JsonSchema = { type?: string; properties?: Record<string, unknown>; required?: string[]; [key: string]: unknown };

/** One MCP tool per editor tool: the variant's own schema, minus `tool`, plus `projectId`. */
export function editorMcpTools(): Array<{ name: string; description: string; inputSchema: JsonSchema; tool: string }> {
  return EditorToolCall.options.map((variant) => {
    const tool = (variant.shape.tool as z.ZodLiteral<string>).value;
    const schema = z.toJSONSchema(variant, { io: "input" }) as JsonSchema;
    const { tool: _omit, ...properties } = (schema.properties ?? {}) as Record<string, unknown>; void _omit;
    return {
      tool,
      name: mcpToolName(tool),
      description: DESCRIPTIONS[tool] ?? tool,
      inputSchema: {
        ...schema, type: "object",
        properties: { projectId: { type: "string", description: "The project id" }, ...properties },
        required: ["projectId", ...(schema.required ?? []).filter((r) => r !== "tool")],
        additionalProperties: false,
      },
    };
  });
}

const EXTRA = [
  { name: "agentcut_projects_list", description: "Every project in the workspace with its status.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "agentcut_message_record", description: "Record what you did or decided in the project's conversation, so the web shows it. role defaults to agent.", inputSchema: { type: "object", properties: { projectId: { type: "string" }, text: { type: "string" }, role: { type: "string", enum: ["user", "agent"] }, sequenceId: { type: "string" } }, required: ["projectId", "text"], additionalProperties: false } },
  { name: "agentcut_message_send", description: "Ask the host's editing agent to do something in a project, with the conversation behind it. Runs for minutes; returns its reply and the trail of what it did. Tell the human what the trail says rather than only the reply.", inputSchema: { type: "object", properties: { projectId: { type: "string" }, text: { type: "string" }, sequenceId: { type: "string" } }, required: ["projectId", "text"], additionalProperties: false } },
];

export function listMcpTools() {
  return [...EXTRA, ...editorMcpTools().map(({ name, description, inputSchema }) => ({ name, description, inputSchema }))];
}

/** Where a terminal agent's call reports while it runs, so it can relay progress to its human. */
export type McpActivity = (e: { kind: string; name?: string; text: string }) => void;

export async function callMcpTool(name: string, args: Record<string, unknown>, onActivity?: McpActivity): Promise<unknown> {
  if (name === "agentcut_projects_list") return q.listProjects().map((p) => ({ id: p.id, name: p.name, status: p.status, revision: p.revision }));
  if (name === "agentcut_message_record") {
    const a = z.object({ projectId: z.string(), text: z.string().min(1), role: z.enum(["user", "agent"]).default("agent"), sequenceId: z.string().optional() }).parse(args);
    return recordMessage(a.projectId, { role: a.role, source: "mcp", text: a.text, sequenceId: a.sequenceId });
  }
  if (name === "agentcut_message_send") {
    const a = z.object({ projectId: z.string(), text: z.string().min(1), sequenceId: z.string().optional() }).parse(args);
    // The run takes minutes. Its trail goes back with the reply so the terminal can
    // say what happened, and into the events table so the web says it at the same time.
    const activity: string[] = [];
    const { reply } = await sendMessage(a.projectId, a.text, {
      source: "mcp", sequenceId: a.sequenceId,
      onEvent: (e) => {
        if (e.kind === "log" && !e.name) return;
        activity.push(formatActivity(e));
        onActivity?.({ kind: e.kind, name: e.name, text: e.text });
        recordActivity(a.projectId, e, "mcp");
      },
    });
    return { ...reply, activity: activity.slice(-200) };
  }
  const entry = editorMcpTools().find((t) => t.name === name);
  if (!entry) throw new Error(`Unknown tool: ${name}`);
  const { projectId, ...rest } = args;
  if (typeof projectId !== "string" || !projectId) throw new Error("projectId is required");
  return runReportedTool(projectId, { tool: entry.tool, ...rest }, { via: "mcp", onActivity });
}

type Request = { jsonrpc: "2.0"; id?: number | string | null; method: string; params?: Record<string, unknown> };

/** Send a JSON-RPC notification back to the client mid-call. */
export type McpNotify = (method: string, params: Record<string, unknown>) => void;

export async function handleMcpRequest(request: Request, version: string, notify?: McpNotify): Promise<unknown | undefined> {
  switch (request.method) {
    case "initialize": return { protocolVersion: PROTOCOL, capabilities: { tools: {} }, serverInfo: { name: "agentcut", version } };
    case "ping": return {};
    case "tools/list": return { tools: listMcpTools() };
    case "tools/call": {
      const params = (request.params ?? {}) as { name?: string; arguments?: Record<string, unknown>; _meta?: { progressToken?: string | number } };
      // A client that asked for progress gets a line per step while the call runs;
      // one that did not still gets everything, in the result.
      const token = params._meta?.progressToken;
      let step = 0;
      const onActivity = notify && token !== undefined
        ? (e: { kind: string; name?: string; text: string }) => notify("notifications/progress", { progressToken: token, progress: ++step, message: formatActivity({ ...e, at: Date.now() }) })
        : undefined;
      try {
        const result = await callMcpTool(String(params.name ?? ""), params.arguments ?? {}, onActivity);
        return { content: [{ type: "text", text: JSON.stringify(result ?? null) }] };
      } catch (error) {
        const detail = error instanceof RevisionConflict ? { error: error.message, current: error.current } : { error: (error as Error).message };
        return { content: [{ type: "text", text: JSON.stringify(detail) }], isError: true };
      }
    }
    default:
      if (request.method.startsWith("notifications/")) return undefined;
      throw Object.assign(new Error(`Method not found: ${request.method}`), { code: -32601 });
  }
}

/** Serve until stdin closes. */
export function serveMcp(input: NodeJS.ReadableStream, output: NodeJS.WritableStream, version = "0") {
  const reply = (message: unknown) => output.write(JSON.stringify(message) + "\n");
  const lines = createInterface({ input, crlfDelay: Infinity });
  // Requests are answered in the order they arrived: an edit after a read must see the read's revision.
  let chain = Promise.resolve();
  const handle = async (line: string) => {
    if (!line.trim()) return;
    let request: Request;
    try { request = JSON.parse(line); } catch { reply({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }); return; }
    try {
      const result = await handleMcpRequest(request, version, (method, params) => reply({ jsonrpc: "2.0", method, params }));
      if (request.id !== undefined && request.id !== null) reply({ jsonrpc: "2.0", id: request.id, result: result ?? {} });
    } catch (error) {
      if (request.id !== undefined && request.id !== null) reply({ jsonrpc: "2.0", id: request.id, error: { code: (error as { code?: number }).code ?? -32000, message: (error as Error).message } });
    }
  };
  return new Promise<void>((resolve) => {
    lines.on("line", (line) => { chain = chain.then(() => handle(line)); });
    lines.on("close", () => { void chain.then(() => resolve()); });
  });
}
