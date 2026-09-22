"use client";
import { useCallback, useSyncExternalStore } from "react";
import type { HarnessStatus } from "../server/detect";
import type { ResolvedSelection, Selection, taskSelections } from "../server/selection";

/** One kind of work, what it resolves to today, and whether that is its own choice. */
export type TaskSelection = ReturnType<typeof taskSelections>[number];

/**
 * One copy of "which harnesses exist and which one is picked", shared by every
 * prompt surface in the app.
 *
 * A module-level store rather than a context provider, deliberately. The picker
 * has to be droppable into any composer — the editor chat, the onboarding
 * interview, the welcome screen, a rules panel — and requiring each of those to
 * be wrapped in a provider is how you end up with two of them out of sync, or
 * with a surface that silently cannot show the picker at all. Here, mounting
 * the component is the whole integration.
 *
 * Detection spawns nothing on the client; it is one GET. But it is one GET per
 * scope, cached, so five composers on a page cost one request.
 */
export type AgentsSnapshot = {
  harnesses: HarnessStatus[];
  selection: ResolvedSelection;
  override: Selection | null;
  workspaceDefault: Selection | null;
  /** Model per task (decision 50). Workspace-wide, so it is the same list in every scope. */
  tasks: TaskSelection[];
  loading: boolean;
  error: string;
};

const EMPTY: AgentsSnapshot = {
  harnesses: [],
  selection: { provider: "", model: "", scope: "none" },
  override: null,
  workspaceDefault: null,
  tasks: [],
  loading: true,
  error: "",
};

/** Keyed by scope: '' for the workspace, the project id otherwise. */
const snapshots = new Map<string, AgentsSnapshot>();
const listeners = new Map<string, Set<() => void>>();
const inflight = new Map<string, Promise<void>>();

function emit(scope: string): void {
  for (const listener of listeners.get(scope) ?? []) listener();
}

function set(scope: string, patch: Partial<AgentsSnapshot>): void {
  snapshots.set(scope, { ...(snapshots.get(scope) ?? EMPTY), ...patch });
  emit(scope);
}

async function load(scope: string, force = false): Promise<void> {
  const existing = inflight.get(scope);
  if (existing && !force) return existing;
  const task = (async () => {
    try {
      const url = scope ? `/api/agents?projectId=${encodeURIComponent(scope)}` : "/api/agents";
      const res = await fetch(url);
      const body = (await res.json()) as Partial<AgentsSnapshot> & { error?: string };
      if (!res.ok) throw new Error(body.error ?? "The harnesses could not be read.");
      set(scope, { ...body, loading: false, error: "" });
    } catch (error) {
      set(scope, { loading: false, error: (error as Error).message });
    } finally {
      inflight.delete(scope);
    }
  })();
  inflight.set(scope, task);
  return task;
}

function subscribe(scope: string, listener: () => void): () => void {
  let bucket = listeners.get(scope);
  if (!bucket) listeners.set(scope, (bucket = new Set()));
  bucket.add(listener);
  if (!snapshots.has(scope)) void load(scope);
  return () => {
    bucket.delete(listener);
  };
}

function getSnapshot(scope: string): AgentsSnapshot {
  return snapshots.get(scope) ?? EMPTY;
}

/** The server renders nothing harness-specific; this keeps hydration quiet. */
function getServerSnapshot(): AgentsSnapshot {
  return EMPTY;
}

export function useAgents(projectId?: string) {
  const scope = projectId ?? "";
  const snapshot = useSyncExternalStore(
    useCallback((listener: () => void) => subscribe(scope, listener), [scope]),
    useCallback(() => getSnapshot(scope), [scope]),
    getServerSnapshot,
  );

  /** Persist a pick, then reflect what the server says is now in force. */
  const select = useCallback(
    async (provider: string, model: string) => {
      const previous = getSnapshot(scope);
      // Optimistic: the popover closes on pick and a chip that keeps the old
      // label for a round trip reads as a pick that did not take.
      set(scope, {
        selection: { provider: provider as ResolvedSelection["provider"], model, scope: scope ? "project" : "workspace" },
      });
      try {
        const res = await fetch("/api/agents", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "select", provider, model, ...(scope ? { projectId: scope } : {}) }),
        });
        const body = (await res.json()) as { selection?: ResolvedSelection; override?: Selection | null; error?: string };
        if (!res.ok) throw new Error(body.error ?? "The selection could not be saved.");
        set(scope, { selection: body.selection ?? previous.selection, override: body.override ?? null, error: "" });
      } catch (error) {
        set(scope, { selection: previous.selection, error: (error as Error).message });
      }
    },
    [scope],
  );

  /**
   * The harness and model for one kind of work. Saved at workspace level whatever
   * scope this hook was mounted in, because a task choice is about the work, not
   * about a project — and every scope is reloaded so no picker keeps a stale list.
   */
  const selectTask = useCallback(
    async (task: string, provider: string, model: string) => {
      try {
        const res = await fetch("/api/agents", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "select", scope: "task", task, provider, model }),
        });
        const body = (await res.json()) as { tasks?: TaskSelection[]; error?: string };
        if (!res.ok) throw new Error(body.error ?? "The choice could not be saved.");
        set(scope, { tasks: body.tasks ?? [], error: "" });
        for (const other of snapshots.keys()) if (other !== scope) void load(other, true);
      } catch (error) {
        set(scope, { error: (error as Error).message });
      }
    },
    [scope],
  );

  /** Re-ask every installed CLI for its models. Slow on purpose; user-triggered only. */
  const refresh = useCallback(async () => {
    set(scope, { loading: true });
    try {
      const res = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "refresh" }),
      });
      const body = (await res.json()) as { harnesses?: HarnessStatus[]; error?: string };
      if (!res.ok) throw new Error(body.error ?? "The models could not be refreshed.");
      set(scope, { harnesses: body.harnesses ?? [], loading: false, error: "" });
      // Every other scope now holds a stale catalog for the same machine.
      for (const other of snapshots.keys()) if (other !== scope) void load(other, true);
    } catch (error) {
      set(scope, { loading: false, error: (error as Error).message });
    }
  }, [scope]);

  return { ...snapshot, select, selectTask, refresh, reload: useCallback(() => load(scope, true), [scope]) };
}

/** Test seam: drop everything so a fresh mount refetches. */
export function resetAgentStore(): void {
  snapshots.clear();
  inflight.clear();
}
