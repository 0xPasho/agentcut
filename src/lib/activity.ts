/**
 * What an editing run is doing, in one line per step.
 *
 * Every interface shows the same trail: the web panel streams it over SSE, the CLI
 * prints it to stderr, a terminal agent over MCP receives it as progress and can
 * relay it. The summaries live here so all three read alike — a raw request JSON is
 * not feedback, it is a dump.
 */

const MAX = 160;

const clip = (s: string, max = MAX) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

const value = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.length <= 3 ? v.map(value).filter(Boolean).join(", ") : `${v.length} items`;
  if (typeof v === "object") {
    const keys = Object.keys(v as object);
    return keys.length ? `{${keys.slice(0, 4).join(", ")}${keys.length > 4 ? ", …" : ""}}` : "";
  }
  return "";
};

/** Which argument identifies the call, per tool. The first one present is shown. */
const SUBJECT: Record<string, string[]> = {
  "media.import": ["file"],
  "media.upload": ["name"],
  "assets.search": ["query"],
  "assets.adopt": ["query"],
  "assets.list": ["kind"],
  "assets.capture": ["atSec"],
  "assets.browseLocal": ["folder"],
  "assets.importLocal": ["file"],
  "assets.importFolder": ["folder"],
  "assets.import": ["file"],
  "assets.upload": ["name"],
  "templates.get": ["id"],
  "templates.save": ["id", "from"],
  "templates.delete": ["id"],
  "templates.preview": ["id"],
  "templates.suggest": ["sequenceId", "clipId"],
  "sequence.derive": ["aspect", "sequenceId"],
  "rules.get": ["id"],
  "rules.save": ["level"],
  "rules.delete": ["id"],
  "rules.evaluate": ["sequenceId", "clipId"],
  "plan.generate": ["scope"],
  "media.transcribe": ["mediaIds"],
  "project.batch": ["brief"],
  "packs.inspect": ["source"],
  "packs.import": ["source"],
  "packs.remove": ["id"],
  "packs.export": ["name"],
  "conversation.undo": ["messageId"],
  "preferences.set": ["level"],
  "glossary.save": ["level"],
  "project.status": ["since"],
};

/** Reads as an action, for the tools a run leans on most. */
const VERB: Record<string, string> = {
  "project.read": "reading the project",
  "project.status": "checking status",
  "plan.read": "reading the plan",
  "templates.list": "listing templates",
  "templates.schema": "reading the template schema",
  "templates.suggest": "ranking templates",
  "rules.list": "reading the rules",
  "rules.evaluate": "judging which rules hold",
  "assets.providers": "checking image providers",
  "conversation.read": "reading the conversation",
  "observations.read": "reading what you corrected",
  "project.render": "rendering",
  "transcript.resync": "re-recognising the audio",
  "media.transcribe": "transcribing media",
  "project.batch": "starting the batch",
};

/** `3 changes · item.patch ×2, item.place` — the shape of an edit, not its payload. */
export function describeOperations(operations: unknown): string {
  if (!Array.isArray(operations) || !operations.length) return "no operations";
  const counts = new Map<string, number>();
  for (const op of operations) {
    const type = (op as { type?: unknown })?.type;
    const key = typeof type === "string" ? type : "operation";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const parts = [...counts].map(([type, n]) => (n > 1 ? `${type} ×${n}` : type));
  const head = `${operations.length} change${operations.length === 1 ? "" : "s"}`;
  // A single change is worth naming outright: "item.patch item-3" says more than a tally.
  if (operations.length === 1) {
    const op = operations[0] as Record<string, unknown>;
    const id = op.id ?? op.itemId ?? op.clipId ?? op.sequenceId;
    return clip(`${parts[0]}${typeof id === "string" ? ` ${id}` : ""}`);
  }
  return clip(`${head} · ${parts.join(", ")}`);
}

/** One line for a tool call: the tool's name and what it is about to do. */
export function describeToolCall(request: unknown): { name: string; text: string } {
  const call = (request && typeof request === "object" ? request : {}) as Record<string, unknown>;
  const tool = typeof call.tool === "string" ? call.tool : "tool";
  if (tool === "project.edit") return { name: tool, text: describeOperations(call.operations) };
  if (tool === "template.apply" || tool === "template.plan" || tool === "plan.apply" || tool === "rules.apply") {
    const target = call.sequenceId ?? call.clipId;
    const what = call.templateId ?? (Array.isArray(call.ruleIds) ? (call.ruleIds as unknown[]).join(", ") : undefined) ?? (call.all ? "every video" : "");
    return { name: tool, text: clip([value(what), target ? `on ${value(target)}` : ""].filter(Boolean).join(" ")) };
  }
  const subject = (SUBJECT[tool] ?? []).map((key) => call[key]).find((v) => v !== undefined && v !== null && v !== "");
  const verb = VERB[tool];
  if (subject !== undefined) return { name: tool, text: clip(verb ? `${verb} · ${value(subject)}` : value(subject)) };
  if (verb) return { name: tool, text: verb };
  // Nothing known about this tool: show the arguments it was actually given.
  const { tool: _omit, expectedRevision: _rev, base64: _bytes, ...rest } = call; void _omit; void _rev; void _bytes;
  const args = Object.entries(rest).map(([k, v]) => `${k}=${value(v)}`).filter((s) => !s.endsWith("=")).join(" ");
  return { name: tool, text: clip(args) };
}

/** What came back, when it can be said in a few words. Null when the result speaks for itself. */
export function describeToolResult(tool: string, data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  if (Array.isArray(data)) return `${data.length} ${tool === "assets.search" ? "images" : "results"}`;
  const d = data as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof d.revision === "number") parts.push(`revision ${d.revision}`);
  if (d.job && typeof d.job === "object") parts.push(`job ${(d.job as { id?: string }).id ?? ""}`.trim());
  return parts.length ? clip(parts.join(" · ")) : null;
}

/** `[12:04:31] project.edit  3 changes` — the trail as a terminal agent or the CLI prints it. */
export function formatActivity(e: { kind: string; name?: string | null; text: string; at?: number }): string {
  const stamp = e.at ? new Date(e.at).toTimeString().slice(0, 8) : "";
  const badge = e.name && e.name !== "editor" ? ` ${e.name}` : e.kind === "stage" ? " stage" : "";
  return clip(`${stamp ? `[${stamp}]` : ""}${badge ? `${badge} ·` : ""} ${e.text}`.trim(), 400);
}

/** Fields whose value is bulk, not information: say how much there was of it. */
const BULK = new Set(["content", "new_string", "old_string", "base64", "text", "prompt"]);

/**
 * A harness tool call — Read, Grep, Bash, Write — as one line.
 *
 * The subject comes first and the rest of the arguments follow, because a `Grep`
 * without its path or its glob is half a fact. Paths are shown relative to the run
 * directory: the absolute path to a run's scratch folder is the same forty
 * characters every time and pushes the part that differs off the edge.
 */
export function describeAgentToolInput(input: unknown, cwd?: string): string {
  if (!input || typeof input !== "object") return "";
  const rest = { ...(input as Record<string, unknown>) };
  const rel = (s: string) => (cwd && s.startsWith(cwd) ? s.slice(cwd.length).replace(/^[/\\]/, "") || "." : s);
  const parts: string[] = [];
  for (const key of ["command", "pattern", "file_path", "path", "url", "query", "description"]) {
    const v = rest[key];
    if (typeof v !== "string" || !v) continue;
    parts.push(key === "pattern" || key === "query" ? JSON.stringify(v) : rel(v));
    delete rest[key];
    break;
  }
  for (const [key, v] of Object.entries(rest)) {
    if (v === undefined || v === null || v === "" || v === false) continue;
    if (BULK.has(key)) { parts.push(`${key}=${String(v).length} chars`); continue; }
    parts.push(`${key}=${typeof v === "string" ? rel(v) : value(v)}`);
  }
  return clip(parts.join(" "), 1000);
}
