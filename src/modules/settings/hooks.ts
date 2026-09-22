"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/common/api/client";
import type { RuleRecord } from "@/modules/rules/types";
import type { Glossary } from "@/modules/rules/server/glossary";
import type { Observation } from "@/modules/rules/server/observations";
import type { InstalledPack } from "@/modules/packs/types";
import type { ProviderKeyInfo } from "@/common/server/secrets";
import type { OnboardingState } from "@/modules/onboarding/server/onboarding";
import type { TemplateSlot } from "@/modules/templates/types";
import type { selectionOverview } from "@/modules/agent/server/selection";

export type TemplateOption = { id: string; name: string; builtin: boolean; slots: TemplateSlot[] };
/** Library assets a rule may point a template's slot at. */
export type AssetOption = { id: string; name: string; kind: "image" | "audio" | "video" };

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
  assets: AssetOption[];
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
