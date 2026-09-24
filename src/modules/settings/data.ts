import { BookA, Cpu, Images, LayoutTemplate, Monitor, Package, Scale, UserRound } from "lucide-react";
import type { Rule } from "../rules/types";
import type { GlossaryTerm } from "../rules/server/glossary";
import type { WorkspaceSection, ExportDraft } from "./types";


/**
 * The rail: everything that belongs to the person rather than to a project
 * (decision 130). One list, read by the rail, by the page titles and by the tests,
 * so a section cannot be renamed in one place and not the other. The library is
 * first because it is the one opened most; You is the profile, at the root of
 * settings (decision 131).
 */
export const WORKSPACE_SECTIONS: readonly WorkspaceSection[] = [
  { id: "library", href: "/library", label: "Library", icon: Images, blurb: "Images, sounds and reusable video for every project." },
  { id: "profile", href: "/settings", label: "You", icon: UserRound, blurb: "What you make, who it is for, and how you like it done." },
  { id: "rules", href: "/settings/rules", label: "Rules", icon: Scale, blurb: "Standing instructions the agent judges against every video." },
  { id: "glossary", href: "/settings/glossary", label: "Glossary", icon: BookA, blurb: "Names spelled right, and the ones with a look of their own." },
  { id: "packs", href: "/settings/packs", label: "Packs", icon: Package, blurb: "Templates, rules, names and assets that travel together." },
  { id: "templates", href: "/settings/templates", label: "Templates", icon: LayoutTemplate, blurb: "The layouts on this machine, and where each came from." },
  { id: "agents", href: "/settings/agents", label: "Agents", icon: Cpu, blurb: "Which coding agent does which work." },
  { id: "machine", href: "/settings/machine", label: "This machine", icon: Monitor, blurb: "Where the workspace is, what runs on import, and the keys." },
] as const;

export const workspaceSection = (id: string): WorkspaceSection => WORKSPACE_SECTIONS.find((s) => s.id === id)!;


/**
 * Rules for every project, with the whole story in one place: what each one judges,
 * what it does about it, whether it is on, and the order they run in. Rules about
 * one project or one video stay in the editor, beside the video they are about.
 *
 * Every button here calls `rules.save` or `rules.delete` — the tools an agent calls,
 * with the same schema doing the same validation. There is no settings-only writer.
 */
export const EMPTY_RULE: Rule = { id: "", name: "", description: "", when: "", stage: "both", priority: 100, enabled: true, then: {} };


export const STAGE_LABELS: Record<string, string> = { select: "Choosing clips", edit: "Editing", both: "Choosing and editing" };


export const STAGE_HELP: Record<string, string> = {
  select: "Shapes which moments become clips, before any editing happens.",
  edit: "Shapes how a video is edited once it exists.",
  both: "Both: it shapes the choice of clips and the editing.",
};


/**
 * Subjects (decision 48): the things you talk about often — a game, a channel, a
 * person, a product. A subject is a glossary term that has been given a look, which
 * is why it is not a second list to keep in step: the spelling, the mishearings and
 * the one line of what it is are the glossary's, and the kit is added to the row
 * (decision 132).
 *
 * A project whose plan names the subject inherits that kit when the plan is applied,
 * under any override the project or a rule sets. A rule can say it is about the
 * subject, and those rules are listed beside it so a subject reads as one thing.
 *
 * Not modelled yet: assets that belong to a subject. A library image named after it
 * is still found by name, which is how the picture search has always worked.
 */
export const EMPTY_KIT: NonNullable<GlossaryTerm["brand"]> = {
  palette: { primary: "", secondary: "", text: "", background: "" },
  fonts: { captions: "", titles: "" },
  logo: { slot: "", assetId: "" },
};


/** What the transcription-on-import choice means, in the words the page shows. */
export const TRANSCRIBE_LABELS: Record<string, { label: string; help: string }> = {
  audio: { label: "When there is speech", help: "A new source is recognised when it carries sound. Silent files are skipped for free." },
  always: { label: "Always", help: "Every imported source is recognised, silence included." },
  off: { label: "Never on import", help: "Nothing runs when a source lands. Every source is still one click away in the editor." },
};


export const EMPTY_EXPORT: ExportDraft = {
  id: "", name: "", version: "1.0.0", description: "", author: "",
  templates: new Set(), rules: new Set(), glossary: true, assets: new Set(), quickActions: new Set(), stylePack: "",
};


/** How a library asset got here, in a word a person recognises. */
export const ASSET_SOURCE_LABELS: Record<string, string> = {
  upload: "Uploaded",
  "drop-in": "Dropped into the folder",
  starter: "Comes with agentcut",
  search: "From a search",
  chat: "Sent in chat",
};
