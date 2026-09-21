"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "../client";
import { applyOperations, type EditorOperation, type EditorSnapshot } from "./operations";
import { invertOperations } from "./history";

/** Same revision protocol for every visual editing surface. Drafts never get replaced by polling. */
export function useEditor(projectId: string, initial: EditorSnapshot | null) {
  const [snapshot, setSnapshot] = useState(initial);
  const current = useRef(initial);
  const queue = useRef<EditorOperation[]>([]);
  const inFlight = useRef<Promise<boolean> | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const blocked = useRef(false);
  // Undo replays inverse operations through the same engine, so it obeys the same
  // validation and revision protocol as any other edit rather than restoring a remembered EDL.
  const undos = useRef<EditorOperation[][]>([]);
  const redos = useRef<EditorOperation[][]>([]);
  const [depth, setDepth] = useState({ undo: 0, redo: 0 });
  const syncDepth = () => setDepth({ undo: undos.current.length, redo: redos.current.length });
  const draftKey = `agentcut:draft:${projectId}`;
  const persist = () => {
    try {
      if (queue.current.length) sessionStorage.setItem(draftKey, JSON.stringify({ snapshot: current.current, operations: queue.current }));
      else sessionStorage.removeItem(draftKey);
    } catch { /* beforeunload still protects drafts when browser storage is unavailable */ }
  };
  const publish = (next: EditorSnapshot | null) => { current.current = next; setSnapshot(next); };

  const commit = (operations: EditorOperation[], history: "record" | "undo" | "redo" | "skip") => {
    const state = current.current;
    if (!state) return false;
    if (!operations.length) return true;
    try {
      const inverse = history === "skip" ? null : invertOperations(state.edl, operations);
      const edl = applyOperations(state.edl, operations);
      queue.current.push(...operations);
      publish({ ...state, edl });
      persist();
      setDirty(true);
      if (inverse) {
        if (history === "undo") redos.current.push(inverse);
        else undos.current.push(inverse);
        // A fresh edit forks the timeline of edits; anything redone from here is unreachable.
        if (history === "record") redos.current = [];
        if (undos.current.length > 200) undos.current.shift();
        syncDepth();
      }
      if (!blocked.current) setError(null);
      return true;
    } catch (e) { setError((e as Error).message); return false; }
  };
  /** Returns whether the edit applied, so a caller can report it without duplicating validation. */
  const dispatch = useCallback((operations: EditorOperation[], options?: { history?: "record" | "skip" }) =>
    commit(operations, options?.history ?? "record"), []);
  const undo = useCallback(() => {
    const operations = undos.current.pop();
    if (!operations) return;
    if (!commit(operations, "undo")) undos.current.push(operations);
    syncDepth();
  }, []);
  const redo = useCallback(() => {
    const operations = redos.current.pop();
    if (!operations) return;
    if (!commit(operations, "redo")) redos.current.push(operations);
    syncDepth();
  }, []);

  const save = useCallback(async (): Promise<boolean> => {
    if (inFlight.current) return inFlight.current;
    if (blocked.current) return false;
    if (!current.current || !queue.current.length) return true;
    const run = async () => {
      setSaving(true);
      try {
        while (queue.current.length) {
          const state = current.current!;
          const batch = queue.current.slice();
          const result = await api.edit(projectId, state.revision, batch);
          queue.current.splice(0, batch.length);
          publish({ revision: result.revision, edl: applyOperations(result.edl, queue.current) });
          persist();
        }
        setDirty(false); setError(null);
        return true;
      } catch (e) {
        setError((e as Error).message);
        if (e instanceof ApiError && e.status === 409) { blocked.current = true; setConflict(true); }
        return false;
      } finally { setSaving(false); inFlight.current = null; }
    };
    inFlight.current = run();
    return inFlight.current;
  }, [projectId]);

  const reload = useCallback(async () => {
    if (inFlight.current) await inFlight.current;
    try {
      const p = await api.getProject(projectId);
      queue.current = []; blocked.current = false;
      // Undo history describes edits against the state being replaced.
      undos.current = []; redos.current = []; syncDepth();
      publish(p.edl ? { edl: p.edl, revision: p.revision } : null);
      persist();
      setDirty(false); setConflict(false); setError(null);
    } catch (e) { setError((e as Error).message); }
  }, [projectId]);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(draftKey);
      if (!raw) return;
      const draft = JSON.parse(raw) as { snapshot: EditorSnapshot; operations: EditorOperation[] };
      if (draft.snapshot.edl.projectId !== projectId || !draft.operations.length) return;
      // Preserve the exact draft and its base revision. Polling will detect a newer server revision.
      applyOperations(draft.snapshot.edl, []);
      queue.current = draft.operations;
      publish(draft.snapshot); setDirty(true);
      if (initial && initial.revision !== draft.snapshot.revision) {
        blocked.current = true; setConflict(true);
        setError("Your saved draft is based on an older project version. Download it before loading the latest version.");
      }
    } catch { /* leave an unreadable recovery file alone */ }
  }, [projectId]);

  useEffect(() => {
    if (!dirty || conflict) return;
    const timer = setTimeout(() => { void save(); }, 500);
    return () => clearTimeout(timer);
  }, [snapshot, dirty, conflict, save]);

  useEffect(() => {
    let disposed = false;
    const poll = async () => {
      try {
        const p = await api.getProject(projectId);
        if (disposed || inFlight.current || !p.edl) return;
        if (current.current && p.revision <= current.current.revision) return;
        if (queue.current.length) {
          blocked.current = true; setConflict(true);
          setError("This project changed elsewhere. Your draft is preserved. Download it before loading the latest version.");
        } else publish({ edl: p.edl, revision: p.revision });
      } catch { /* preserve local state on a transient network failure */ }
    };
    const timer = setInterval(poll, 1000);
    // A background tab's timers are throttled to about once a minute, and the agent edits the
    // same project. Coming back to the window has to show its work at once, not a minute later.
    const resume = () => { if (document.visibilityState === "visible") void poll(); };
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("focus", resume);
    return () => {
      disposed = true; clearInterval(timer);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("focus", resume);
    };
  }, [projectId]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const downloadDraft = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(current.current, null, 2)], { type: "application/json" }));
    const a = document.createElement("a"); a.href = url; a.download = `${projectId}-draft.json`; a.click(); URL.revokeObjectURL(url);
  };
  return { snapshot, dispatch, undo, redo, canUndo: depth.undo > 0, canRedo: depth.redo > 0, save, reload, downloadDraft, dirty, saving, error, conflict };
}
