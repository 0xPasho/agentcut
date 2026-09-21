import { createInterface } from "node:readline";
import { z } from "zod";
import { q } from "./db";
import { EditorToolCall, executeEditorTool } from "./editor/tools";
import { RevisionConflict } from "./editor/store";
import { recordMessage, sendMessage } from "./editor/conversation";

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
  "project.edit": "Apply editing operations against expectedRevision. Same operations as the UI.",
  "project.render": "Render the current revision to mp4.",
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
  "media.transcribe": "Transcribe imported media and put the words on every shot cut from it.",
  "project.batch": "Start the batch: transcribe, plan and edit every pending video under the shared plan. Returns a job.",
  "glossary.get": "Names and how they are spelled.",
  "glossary.save": "Write the glossary at a level.",
  "preferences.get": "The owner's preferences, both levels.",
  "preferences.set": "Write preferences at a level.",
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
  { name: "agentcut_message_send", description: "Ask the host's editing agent to do something in a project, with the conversation behind it. Returns its reply.", inputSchema: { type: "object", properties: { projectId: { type: "string" }, text: { type: "string" }, sequenceId: { type: "string" } }, required: ["projectId", "text"], additionalProperties: false } },
];

export function listMcpTools() {
  return [...EXTRA, ...editorMcpTools().map(({ name, description, inputSchema }) => ({ name, description, inputSchema }))];
}

export async function callMcpTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  if (name === "agentcut_projects_list") return q.listProjects().map((p) => ({ id: p.id, name: p.name, status: p.status, revision: p.revision }));
  if (name === "agentcut_message_record") {
    const a = z.object({ projectId: z.string(), text: z.string().min(1), role: z.enum(["user", "agent"]).default("agent"), sequenceId: z.string().optional() }).parse(args);
    return recordMessage(a.projectId, { role: a.role, source: "mcp", text: a.text, sequenceId: a.sequenceId });
  }
  if (name === "agentcut_message_send") {
    const a = z.object({ projectId: z.string(), text: z.string().min(1), sequenceId: z.string().optional() }).parse(args);
    const { reply } = await sendMessage(a.projectId, a.text, { source: "mcp", sequenceId: a.sequenceId });
    return reply;
  }
  const entry = editorMcpTools().find((t) => t.name === name);
  if (!entry) throw new Error(`Unknown tool: ${name}`);
  const { projectId, ...rest } = args;
  if (typeof projectId !== "string" || !projectId) throw new Error("projectId is required");
  return executeEditorTool(projectId, { tool: entry.tool, ...rest });
}

type Request = { jsonrpc: "2.0"; id?: number | string | null; method: string; params?: Record<string, unknown> };

export async function handleMcpRequest(request: Request, version: string): Promise<unknown | undefined> {
  switch (request.method) {
    case "initialize": return { protocolVersion: PROTOCOL, capabilities: { tools: {} }, serverInfo: { name: "agentcut", version } };
    case "ping": return {};
    case "tools/list": return { tools: listMcpTools() };
    case "tools/call": {
      const params = (request.params ?? {}) as { name?: string; arguments?: Record<string, unknown> };
      try {
        const result = await callMcpTool(String(params.name ?? ""), params.arguments ?? {});
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
      const result = await handleMcpRequest(request, version);
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
