import { db } from "../db";
import { harness, type HarnessId } from "./registry";

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
  scope: "project" | "workspace" | "none";
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
export function resolveSelection(projectId?: string): ResolvedSelection {
  if (projectId) {
    const own = read(scopeFor(projectId));
    if (own?.provider) return { ...own, scope: "project" };
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
): { provider?: string; model?: string } {
  const saved = resolveSelection(projectId);
  const provider = explicit.provider || saved.provider || undefined;
  const model = explicit.model || (explicit.provider && explicit.provider !== saved.provider ? "" : saved.model) || undefined;
  return { ...(provider ? { provider } : {}), ...(model ? { model } : {}) };
}
