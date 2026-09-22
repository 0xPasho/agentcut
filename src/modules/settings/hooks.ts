"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "../../common/api/client";

import { type WorkspaceSettings, type Workspace } from "./types";

export function useWorkspaceSettings(): Workspace {
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
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending("");
    }
  }, [reload]);

  return { data, error, pending, reload, run, setError };
}
