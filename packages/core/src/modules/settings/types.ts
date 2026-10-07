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
import { z } from "zod";


/**
 * The glossary: a spelling, the ways a recogniser gets it wrong, and one line of
 * what the thing is. Deterministic — it feeds the recogniser's vocabulary hint, the
 * proofreader and a find-and-replace over the transcript — which is why it is a
 * table and not a rule.
 *
 * `glossary.save` writes a level whole. The workspace list now holds only one
 * active name draft, so saving it cannot silently save another unfinished row.
 */
export type Row = { term: string; aliases: string; note: string; brand?: GlossaryTerm["brand"] };

/** Only the selected name is drafted; null index creates a new glossary entry. */
export type GlossarySelection = { term: GlossaryTerm; index: number | null };


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


/** The marks the rail can draw. The studio maps each name to its icon component. */
export type WorkspaceIcon = "calendar" | "publishing" | "library" | "profile" | "rules" | "glossary" | "packs" | "templates" | "agents" | "machine";

/** One entry of the rail: a place, its icon, and the sentence that says what it decides. */
export type WorkspaceSection = {
  id: string;
  href: string;
  label: string;
  icon: WorkspaceIcon;
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

export const SnapshotColumn = z.object({ name: z.string().regex(/^[a-z_][a-z0-9_]*$/), type: z.enum(["", "TEXT", "INTEGER", "REAL", "BLOB", "NUMERIC"]), notNull: z.boolean(), primaryKey: z.number().int().min(0) }).strict();
export const SnapshotTable = z.object({ name: z.string(), columns: z.array(SnapshotColumn).min(1).max(100), rows: z.array(z.array(z.union([z.string(), z.number().finite(), z.null()]))) }).strict();
export type SnapshotTable = z.infer<typeof SnapshotTable>;
export const SnapshotHeader = z.object({
  format: z.literal("agentcut-workspace"), version: z.literal(1), createdAt: z.iso.datetime(),
  sourceWorkspace: z.string().min(1), sourceRoot: z.string().min(1),
  files: z.number().int().nonnegative(), tables: z.number().int().nonnegative(),
  omitted: z.array(z.object({ path: z.string(), bytes: z.number().nonnegative() }).strict()),
}).strict();
export type SnapshotHeader = z.infer<typeof SnapshotHeader>;
export const SnapshotFile = z.object({ path: z.string().min(1), sha256: z.string().regex(/^[a-f0-9]{64}$/), data: z.string() }).strict();
export type SnapshotFile = z.infer<typeof SnapshotFile>;
export type SnapshotInventory = { files: Array<{ path: string; bytes: number; modifiedAt: number }>; omitted: SnapshotHeader["omitted"] };
export type SnapshotRead = { header: SnapshotHeader; tables: SnapshotTable[]; files: Array<{ path: string; sha256: string }>; fingerprint: string };
export type SnapshotPreview = {
  createdAt: string; projects: number; packs: number; files: number; publications: number;
  omittedMedia: number; includesCredentials: boolean; fingerprint: string;
};
export type SnapshotExport = SnapshotPreview & { id: string; file: string; bytes: number; downloadUrl: string };
export type SnapshotImport = { backup: SnapshotExport; restored: SnapshotPreview };
export const SnapshotCommand = z.discriminatedUnion("tool", [
  z.object({ tool: z.literal("workspace.snapshot.export"), destination: z.string().optional() }).strict(),
  z.object({ tool: z.literal("workspace.snapshot.preview"), file: z.string().min(1) }).strict(),
  z.object({ tool: z.literal("workspace.snapshot.restore"), file: z.string().min(1), fingerprint: z.string().regex(/^[a-f0-9]{64}$/), confirm: z.literal("replace-workspace-data") }).strict(),
]);
export type SnapshotCommand = z.infer<typeof SnapshotCommand>;
