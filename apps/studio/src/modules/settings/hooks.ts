"use client";
import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "@agentcut/core/common/api/client";

import { type WorkspaceSettings, type Workspace } from "@agentcut/core/modules/settings/types";

const WorkspaceContext = createContext<Workspace | null>(null);

/**
 * One read of `GET /api/workspace` for the whole shell: the rail's counts and the
 * page's content come from the same answer, so a save on the page moves the count
 * beside its name without a second request or a stale number.
 */
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<WorkspaceSettings | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState("");

  const reload = useCallback(async () => {
    try {
      setData(await api.workspace<WorkspaceSettings>());
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  const run = useCallback(async (label: string, call: () => Promise<unknown>) => {
    setPending(label);
    setError("");
    try {
      await call();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      // Reload whether or not the write went through: a call that wrote three rules
      // and failed on the fourth has changed the disk, and the page must say so.
      await reload();
      setPending("");
    }
  }, [reload]);

  const value = useMemo(() => ({ data, error, pending, reload, run, setError }), [data, error, pending, reload, run]);
  return createElement(WorkspaceContext.Provider, { value }, children);
}

/** The shell's workspace. Every page under the rail reads the same answer. */
export function useWorkspaceSettings(): Workspace {
  const shared = useContext(WorkspaceContext);
  if (!shared) throw new Error("useWorkspaceSettings needs the workspace shell around it.");
  return shared;
}
