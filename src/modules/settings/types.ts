import type { ComponentType, SVGProps } from "react";
import type { GlossaryTerm, Glossary } from "../rules/server/glossary";
import type { TemplateSlot, TemplateSelection, VideoTemplate } from "../templates/types";
import type { RuleRecord } from "../rules/types";
import type { Observation } from "../rules/server/observations";
import type { OnboardingState } from "../onboarding/server/onboarding";
import type { OnboardingQuestion } from "../onboarding/server/onboarding";
import type { InstalledPack } from "../packs/types";
import type { ProviderKeyInfo } from "../../common/server/secrets";
import type { selectionOverview } from "../agent/server/selection";
import type { TranscribeMode } from "../transcription/server/settings";
import type { chatSource } from "../stream-comments/server/comments";


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


/** A template as the settings pages see it: enough to list, preview and delete, never to edit. */
export type TemplateOption = {
  id: string;
  name: string;
  description: string;
  tags: string[];
  builtin: boolean;
  slots: TemplateSlot[];
  extends: string | null;
  makes: TemplateSelection | null;
  output: NonNullable<VideoTemplate["output"]> | null;
  /** The installed pack whose manifest names this template, if one does. */
  pack: string | null;
};


/** Library assets a rule may point a template's slot at. */
export type AssetOption = { id: string; name: string; kind: "image" | "audio" | "video" };


/** A workspace rule, with the pack that brought it when one did. */
export type RuleOption = RuleRecord & { pack: string | null };


/** What is on this machine that is neither the person's taste nor a project. */
export type MachineSettings = {
  /** Where the workspace lives on disk, and its database. */
  workspace: string;
  database: string;
  transcribe: {
    mode: TranscribeMode;
    scope: "env" | "project" | "workspace" | "default";
    /** What the workspace level itself says, `null` when it inherits the default. */
    stored: TranscribeMode | null;
  };
  chat: ReturnType<typeof chatSource>;
};


/**
 * Everything the workspace pages read, in one request. `GET /api/workspace` is the
 * same endpoint the editor's rules panel already used; the pages are one more reader
 * of it, not a second source of truth.
 */
export type WorkspaceSettings = {
  rules: RuleOption[];
  glossary: Glossary;
  preferences: string;
  templates: TemplateOption[];
  assets: AssetOption[];
  /** The JSON schema a rule is validated against — the same object the tools use. */
  schema: unknown;
  observations: Observation[];
  onboarding: OnboardingState & { questions: readonly OnboardingQuestion[] };
  packs: InstalledPack[];
  providerKeys: ProviderKeyInfo[];
  machine: MachineSettings;
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


/** One entry of the rail: a place, its icon, and the sentence that says what it decides. */
export type WorkspaceSection = {
  id: string;
  href: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  blurb: string;
};


/** The export form: every field `packs.export` accepts, as the page holds it before sending. */
export type ExportDraft = {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  templates: Set<string>;
  rules: Set<string>;
  glossary: boolean;
  assets: Set<string>;
  /** Quick actions copied from installed packs, keyed `${pack}:${label}`. */
  quickActions: Set<string>;
  /** The installed pack whose style guide, references and criteria travel with it. */
  stylePack: string;
};
