import { z } from "zod";
import { db } from "../db";
import { harness, HARNESS_IDS, type HarnessId } from "./registry";

/**
 * Which harness and model a run should use.
 *
 * Stored server-side because the server is what spawns the CLI: a batch run, a
 * job resumed after a restart, a terminal agent over MCP — none of those have a
 * browser attached, and all of them must use the harness the owner picked.
 * localStorage would have made the picker a lie for every one of them.
 *
 * Two scopes. The workspace default is the answer for everything; a project may
 * override it, because "this one project needs the big model" is the real
 * exception and re-picking it on every message is not a workflow.
 *
 * An empty `model` means "whatever the CLI defaults to" and is a valid, saved
 * choice — distinct from having picked nothing at all.
 */
export type Selection = { provider: HarnessId | ""; model: string };

export type ResolvedSelection = {
  provider: HarnessId | "";
  model: string;
  /** Where the answer came from, so the UI can show inheritance honestly. */
  scope: "project" | "task" | "workspace" | "none";
};

db.exec(`CREATE TABLE IF NOT EXISTS settings (
  scope TEXT NOT NULL,
  key   TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (scope, key)
)`);

const KEY = "agent.selection";
const WORKSPACE_SCOPE = "workspace";

function scopeFor(projectId?: string): string {
  return projectId ? `project:${projectId}` : WORKSPACE_SCOPE;
}

function read(scope: string): Selection | null {
  const row = db.prepare("SELECT value FROM settings WHERE scope = ? AND key = ?").get(scope, KEY) as
    | { value: string }
    | undefined;
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.value) as Partial<Selection>;
    const provider = typeof parsed.provider === "string" ? parsed.provider : "";
    // A harness that was removed from the registry must not resurrect as a
    // selection nothing can run.
    if (provider && !harness(provider)) return null;
    return { provider: provider as HarnessId | "", model: typeof parsed.model === "string" ? parsed.model : "" };
  } catch {
    return null;
  }
}

/** Save a selection, or clear it so the scope inherits again. */
export function saveSelection(selection: Selection | null, projectId?: string): void {
  const scope = scopeFor(projectId);
  if (!selection || (!selection.provider && !selection.model)) {
    db.prepare("DELETE FROM settings WHERE scope = ? AND key = ?").run(scope, KEY);
    return;
  }
  if (selection.provider && !harness(selection.provider)) {
    throw new Error(`unknown harness: ${selection.provider}`);
  }
  db.prepare(
    "INSERT INTO settings (scope, key, value) VALUES (?, ?, ?) ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value",
  ).run(scope, KEY, JSON.stringify({ provider: selection.provider, model: selection.model }));
}

/**
 * The selection in force for a project: its own override, else the workspace
 * default, else nothing — which leaves `resolveProvider` free to pick the first
 * installed harness, the behaviour from before anybody could choose.
 */
export function resolveSelection(projectId?: string, task?: AgentTask): ResolvedSelection {
  if (projectId) {
    const own = read(scopeFor(projectId));
    if (own?.provider) return { ...own, scope: "project" };
  }
  if (task) {
    const forTask = read(`task:${task}`);
    if (forTask?.provider) return { ...forTask, scope: "task" };
  }
  const workspace = read(WORKSPACE_SCOPE);
  if (workspace?.provider) return { ...workspace, scope: "workspace" };
  return { provider: "", model: "", scope: "none" };
}

/** The raw stored value for one scope, for a settings UI that must not show inherited state as its own. */
export function storedSelection(projectId?: string): Selection | null {
  return read(scopeFor(projectId));
}

/**
 * Fold an explicit per-call choice over the saved one.
 *
 * A caller that names a provider always wins — that is an argument, not a
 * preference. A caller that names only a model keeps the saved provider, which
 * is what "run this one on Opus" means.
 */
export function effectiveSelection(
  projectId: string | undefined,
  explicit: { provider?: string; model?: string } = {},
  task?: AgentTask,
): { provider?: string; model?: string } {
  const saved = resolveSelection(projectId, task);
  const provider = explicit.provider || saved.provider || undefined;
  const model = explicit.model || (explicit.provider && explicit.provider !== saved.provider ? "" : saved.model) || undefined;
  return { ...(provider ? { provider } : {}), ...(model ? { model } : {}) };
}

/**
 * Model per task (decision 50).
 *
 * The same harness is not worth the same money for every job. Choosing which clips
 * come out of two hours of footage, and writing the plan a whole set of videos is
 * built from, are the decisions the strong model earns its cost on; judging which
 * rules hold, reading the observation bank, tagging — those run often, on little
 * material, and a cheap model is the right answer.
 *
 * A task selection is a refinement of the workspace default, not a replacement for
 * the per-project override: "this project needs the big model" is a statement about
 * the project and beats a standing preference about the kind of work. So the order
 * is project override, then this task, then the workspace default, then nothing.
 *
 * A task nobody has configured inherits, which is what makes this safe to add to an
 * existing workspace: it changes nothing until somebody chooses.
 */
export const AGENT_TASKS = [
  { id: "clipping", label: "Finding clips", what: "Reads the whole transcript and decides which moments become clips, with their tags. The strong model earns its cost here." },
  { id: "planning", label: "Writing the plan", what: "The project plan and each video's beat sheet: the decisions every other step follows." },
  { id: "editing", label: "Editing on request", what: "What the agent does when you ask it for something in the editor." },
  { id: "judging", label: "Judging rules and templates", what: "Which rules hold for a video, which template fits. A short question about a short summary." },
  { id: "observations", label: "Reading your corrections", what: "The observation bank, the setup interview and proposals for your preferences." },
] as const;

export type AgentTask = (typeof AGENT_TASKS)[number]["id"];

export const isAgentTask = (id: string): id is AgentTask => AGENT_TASKS.some((t) => t.id === id);

const taskScope = (task: AgentTask) => `task:${task}`;

/** The raw stored choice for one task, for a settings page that must not show inheritance as its own. */
export function storedTaskSelection(task: AgentTask): Selection | null {
  return read(taskScope(task));
}

export function saveTaskSelection(task: AgentTask, selection: Selection | null): void {
  const scope = taskScope(task);
  if (!selection || (!selection.provider && !selection.model)) {
    db.prepare("DELETE FROM settings WHERE scope = ? AND key = ?").run(scope, KEY);
    return;
  }
  if (selection.provider && !harness(selection.provider)) throw new Error(`unknown harness: ${selection.provider}`);
  db.prepare(
    "INSERT INTO settings (scope, key, value) VALUES (?, ?, ?) ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value",
  ).run(scope, KEY, JSON.stringify({ provider: selection.provider, model: selection.model }));
}

/** Every task with what it resolves to today, and whether that is its own choice or inherited. */
export function taskSelections(): Array<{ task: AgentTask; label: string; what: string; own: Selection | null; resolved: ResolvedSelection }> {
  return AGENT_TASKS.map((t) => ({ task: t.id, label: t.label, what: t.what, own: storedTaskSelection(t.id), resolved: resolveSelection(undefined, t.id) }));
}

/** Which task a job of this kind is doing, so the one place jobs apply the choice can name it. */
export function taskForJobKind(kind: string): AgentTask | undefined {
  if (kind === "analyze") return "clipping";
  if (kind === "batch") return "planning";
  if (kind === "edit") return "editing";
  return undefined;
}

/**
 * One way to change any of the three scopes, so the settings page, the `/api/agents`
 * endpoint an editor picker posts to, and the agent tool all validate identically.
 * Clearing is saying nothing: an empty provider deletes the row and the scope
 * inherits again, which is the only way back from "this project needs Opus".
 */
export const SelectionRequest = z.object({
  scope: z.enum(["workspace", "project", "task"]).default("workspace"),
  /** Required when scope is "task". */
  task: z.string().optional(),
  /** Required when scope is "project". */
  projectId: z.string().optional(),
  provider: z.enum(HARNESS_IDS as [string, ...string[]]).or(z.literal("")),
  model: z.string().default(""),
});
export type SelectionRequest = z.infer<typeof SelectionRequest>;

export function applySelection(raw: unknown): void {
  const request = SelectionRequest.parse(raw);
  const selection: Selection = { provider: request.provider as HarnessId | "", model: request.model };
  if (request.scope === "task") {
    if (!request.task || !isAgentTask(request.task)) throw new Error(`Unknown task: ${request.task ?? ""}`);
    saveTaskSelection(request.task, selection);
    return;
  }
  if (request.scope === "project" && !request.projectId) throw new Error("A project selection needs a project");
  saveSelection(selection, request.scope === "project" ? request.projectId : undefined);
}

/** Everything a settings page or an agent needs to know about who runs what, minus the slow machine probe. */
export function selectionOverview(projectId?: string) {
  return {
    selection: resolveSelection(projectId),
    override: projectId ? storedSelection(projectId) : null,
    workspaceDefault: storedSelection(),
    tasks: taskSelections(),
  };
}
