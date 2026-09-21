"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client";
import type { RuleRecord } from "@/lib/rules/schema";
import type { Glossary } from "@/lib/glossary";
import type { Observation } from "@/lib/observations";
import type { InstalledPack } from "@/lib/packs/schema";
import type { ProviderKeyInfo } from "@/lib/secrets";
import type { OnboardingState } from "@/lib/onboarding";
import type { selectionOverview } from "@/lib/agent/selection";

export type TemplateOption = { id: string; name: string; builtin: boolean };

/**
 * Everything the settings pages read, in one request. `GET /api/workspace` is the
 * same endpoint the editor's rules panel already used; the settings pages are one
 * more reader of it, not a second source of truth.
 */
export type WorkspaceSettings = {
  rules: RuleRecord[];
  glossary: Glossary;
  preferences: string;
  templates: TemplateOption[];
  observations: Observation[];
  onboarding: OnboardingState;
  packs: InstalledPack[];
  providerKeys: ProviderKeyInfo[];
} & ReturnType<typeof selectionOverview>;

export type Workspace = {
  data: WorkspaceSettings | null;
  error: string;
  /** The label passed to `run`, while that call is in flight. */
  pending: string;
  reload: () => Promise<void>;
  /** One write, then a reload, so what is on screen is what is on disk. */
  run: (label: string, call: () => Promise<unknown>) => Promise<void>;
  setError: (message: string) => void;
};

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
