"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { api } from "@agentcut/core/common/api/client";
import { ASPECTS } from "@agentcut/core/modules/project/data";
import { IDEA_HARNESSES, IDEAS_POLL_MS } from "@agentcut/core/modules/ideas/data";
import { briefAspect, byColumn, chosenRun, isRunning, positionAt, projectInstruction } from "@agentcut/core/modules/ideas/lib";
import type { BuildIdeaRequest, HarnessOption, Idea, IdeasActions, Save, SavesActions } from "@agentcut/core/modules/ideas/types";

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init?.body ? { ...init, headers: { "Content-Type": "application/json", ...init.headers } } : init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `${res.status} ${res.statusText}`);
  return data as T;
}

/**
 * The board's ideas, kept fresh. Captures arrive from the extension while the board is
 * open, so it always listens: quickly while a harness is writing, slowly otherwise,
 * and not at all while the tab is hidden.
 */
export function useIdeas(initial: Idea[]): { ideas: Idea[]; columns: ReturnType<typeof byColumn>; actions: IdeasActions } {
  const router = useRouter();
  const [ideas, setIdeas] = useState(initial);
  const running = ideas.some(isRunning);

  const refresh = useCallback(async () => {
    const data = await call<{ ideas: Idea[] }>("/api/ideas");
    setIdeas(data.ideas);
  }, []);

  useEffect(() => {
    const every = running ? IDEAS_POLL_MS : IDEAS_POLL_MS * 3;
    const timer = setInterval(() => { if (!document.hidden) void refresh().catch(() => {}); }, every);
    return () => clearInterval(timer);
  }, [running, refresh]);

  const replace = useCallback((idea: Idea) => setIdeas((list) => list.map((i) => (i.id === idea.id ? idea : i))), []);
  const fail = (error: unknown) => { toast.error((error as Error).message); };
  const latest = useRef(ideas);
  latest.current = ideas;

  const actions = useMemo<IdeasActions>(() => ({
    refresh,
    create: async (note) => {
      const { idea } = await call<{ idea: Idea }>("/api/ideas", { method: "POST", body: JSON.stringify({ note }) });
      setIdeas((list) => [idea, ...list]);
      return idea;
    },
    patch: async (id, patch) => {
      try { replace((await call<{ idea: Idea }>(`/api/ideas/${id}`, { method: "PATCH", body: JSON.stringify(patch) })).idea); }
      catch (error) { fail(error); }
    },
    move: async (id, status, index) => {
      const column = byColumn(latest.current)[status];
      const position = positionAt(column, index, id);
      // Moved where it was dropped at once; the server's answer settles it.
      setIdeas((list) => list.map((i) => (i.id === id ? { ...i, status, position } : i)));
      try { replace((await call<{ idea: Idea }>(`/api/ideas/${id}`, { method: "PATCH", body: JSON.stringify({ status, position }) })).idea); }
      catch (error) { fail(error); void refresh(); }
    },
    remove: async (id) => {
      try { await call(`/api/ideas/${id}`, { method: "DELETE" }); setIdeas((list) => list.filter((i) => i.id !== id)); }
      catch (error) { fail(error); }
    },
    unlinkSave: async (id, saveId) => {
      try { replace((await call<{ idea: Idea }>(`/api/ideas/${id}/saves/${saveId}`, { method: "DELETE" })).idea); }
      catch (error) { fail(error); }
    },
    develop: async (id, request) => {
      try { replace((await call<{ idea: Idea }>(`/api/ideas/${id}/develop`, { method: "POST", body: JSON.stringify(request) })).idea); }
      catch (error) { fail(error); }
    },
    stop: async (id) => {
      try { replace((await call<{ idea: Idea }>(`/api/ideas/${id}/develop`, { method: "DELETE" })).idea); }
      catch (error) { fail(error); }
    },
    /**
     * A project from an idea goes through the same endpoints the home screen's chat
     * uses: an empty project in the brief's shape, then the brief as its first turn.
     */
    startProject: async (idea) => {
      try {
        const aspect = briefAspect(chosenRun(idea)?.brief, Object.keys(ASPECTS));
        const created = await call<{ id: string }>("/api/projects/assemble", { method: "POST", body: JSON.stringify({ name: idea.title, ...(aspect ? { aspect } : {}) }) });
        const project = await api.getProject(created.id);
        await api.agentEdit(created.id, projectInstruction(idea), project.revision);
        await call(`/api/ideas/${idea.id}`, { method: "PATCH", body: JSON.stringify({ projectId: created.id, status: "production" }) });
        router.push(`/p/${created.id}/edit`);
      } catch (error) { fail(error); }
    },
  }), [refresh, replace, router]);

  return { ideas, columns: byColumn(ideas), actions };
}

/** The harnesses ideas can be developed with, as installed on this computer. */
export function useHarnessOptions(): HarnessOption[] {
  const [options, setOptions] = useState<HarnessOption[]>([]);
  useEffect(() => {
    call<{ harnesses: HarnessOption[] }>("/api/agents")
      .then((data) => setOptions(data.harnesses
        .filter((h) => (IDEA_HARNESSES as readonly string[]).includes(h.id))
        .map(({ id, label, ready, reason }) => ({ id, label, ready, reason }))))
      .catch(() => setOptions([]));
  }, []);
  return options;
}

/**
 * The library of saves. New ones arrive from the toolbar while the page is open and
 * videos finish downloading in the background, so it keeps listening like the board.
 */
export function useSaves(initial: Save[]): { saves: Save[]; actions: SavesActions } {
  const router = useRouter();
  const [saves, setSaves] = useState(initial);
  const downloading = saves.some((s) => s.mediaStatus === "pending");

  const refresh = useCallback(async () => {
    setSaves((await call<{ saves: Save[] }>("/api/saves")).saves);
  }, []);

  useEffect(() => {
    const every = downloading ? IDEAS_POLL_MS * 2 : IDEAS_POLL_MS * 3;
    const timer = setInterval(() => { if (!document.hidden) void refresh().catch(() => {}); }, every);
    return () => clearInterval(timer);
  }, [downloading, refresh]);

  const fail = (error: unknown) => { toast.error((error as Error).message); };
  const actions = useMemo<SavesActions>(() => ({
    refresh,
    setNote: async (id, note) => {
      try {
        const { save } = await call<{ save: Save }>(`/api/saves/${id}`, { method: "PATCH", body: JSON.stringify({ note }) });
        setSaves((list) => list.map((s) => (s.id === id ? save : s)));
      } catch (error) { fail(error); }
    },
    remove: async (ids) => {
      try {
        await Promise.all(ids.map((id) => call(`/api/saves/${id}`, { method: "DELETE" })));
        setSaves((list) => list.filter((s) => !ids.includes(s.id)));
      } catch (error) { fail(error); }
    },
    buildIdea: async (request: BuildIdeaRequest) => {
      try {
        const { idea } = await call<{ idea: Idea }>("/api/ideas", { method: "POST", body: JSON.stringify(request) });
        router.push(`/ideas?open=${idea.id}`);
      } catch (error) { fail(error); }
    },
  }), [refresh, router]);

  return { saves, actions };
}

/**
 * Everything the preview of one save does beyond showing it: the transcript (read if
 * it exists, recognised on demand), the note, another try at the video, and the ideas
 * it can join. `onChanged` lets whichever list holds the save refresh itself.
 */
export function useSavePreview(save: Save, onChanged: () => void) {
  const [transcript, setTranscript] = useState<string | null>(null);
  const [transcribing, setTranscribing] = useState(false);
  const [ideas, setIdeas] = useState<Array<Pick<Idea, "id" | "title">>>([]);

  useEffect(() => {
    setTranscript(null);
    if (!save.hasTranscript) return;
    call<{ transcript: string | null }>(`/api/saves/${save.id}/transcript`).then((d) => setTranscript(d.transcript)).catch(() => {});
  }, [save.id, save.hasTranscript]);

  useEffect(() => {
    call<{ ideas: Idea[] }>("/api/ideas").then((d) => setIdeas(d.ideas.map(({ id, title }) => ({ id, title })))).catch(() => setIdeas([]));
  }, [save.id, save.ideaIds.length]);

  const fail = (error: unknown) => { toast.error((error as Error).message); };
  return {
    transcript,
    transcribing,
    ideas,
    transcribe: async () => {
      setTranscribing(true);
      try { setTranscript((await call<{ transcript: string }>(`/api/saves/${save.id}/transcript`, { method: "POST" })).transcript); onChanged(); }
      catch (error) { fail(error); }
      finally { setTranscribing(false); }
    },
    retryDownload: async () => {
      try { await call(`/api/saves/${save.id}/download`, { method: "POST" }); onChanged(); }
      catch (error) { fail(error); }
    },
    setNote: async (note: string) => {
      try { await call(`/api/saves/${save.id}`, { method: "PATCH", body: JSON.stringify({ note }) }); onChanged(); }
      catch (error) { fail(error); }
    },
    addToIdea: async (ideaId: string) => {
      try {
        const { idea } = await call<{ idea: Idea }>("/api/ideas", { method: "POST", body: JSON.stringify({ ideaId, saveIds: [save.id], note: "" }) });
        toast.success(`Added to “${idea.title}”`);
        onChanged();
      } catch (error) { fail(error); }
    },
    remove: async () => {
      try { await call(`/api/saves/${save.id}`, { method: "DELETE" }); onChanged(); }
      catch (error) { fail(error); }
    },
  };
}
