import type { GlossaryTerm } from "../rules/server/glossary";
import type { TemplateSlot } from "../templates/types";
import type { RuleRecord } from "../rules/types";
import type { Glossary } from "../rules/server/glossary";
import type { Observation } from "../rules/server/observations";
import type { OnboardingState } from "../onboarding/server/onboarding";
import type { InstalledPack } from "../packs/types";
import type { ProviderKeyInfo } from "../../common/server/secrets";
import type { selectionOverview } from "../agent/server/selection";


/**
 * The glossary: a spelling, the ways a recogniser gets it wrong, and one line of
 * what the thing is. Deterministic — it feeds the recogniser's vocabulary hint, the
 * proofreader and a find-and-replace over the transcript — which is why it is a
 * table and not a rule.
 *
 * One save for the list, because `glossary.save` writes a level whole; a per-row
 * save would be the same write wearing a smaller button, and two rows edited with
 * one saved would quietly save both.
 */
export type Row = { term: string; aliases: string; note: string; brand?: GlossaryTerm["brand"] };


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
