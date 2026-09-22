import { BookA, Cpu, NotebookPen, Package, Scale, Tags } from "lucide-react";
import type { Rule } from "../rules/types";
import type { GlossaryTerm } from "../rules/server/glossary";


/**
 * The six things that belong to the person rather than to a project (decision 36's
 * user level). One list, read by the rail, by the overview and by the page titles,
 * so a section cannot be renamed in one place and not the other.
 */
export const SETTINGS_SECTIONS = [
  {
    id: "rules",
    href: "/settings/rules",
    label: "Rules",
    icon: Scale,
    blurb: "Standing instructions the agent judges against every video.",
  },
  {
    id: "glossary",
    href: "/settings/glossary",
    label: "Glossary",
    icon: BookA,
    blurb: "Names, and how they are spelled in captions and titles.",
  },
  {
    id: "subjects",
    href: "/settings/subjects",
    label: "Subjects",
    icon: Tags,
    blurb: "The things you talk about often, with the look that belongs to them.",
  },
  {
    id: "preferences",
    href: "/settings/preferences",
    label: "Preferences",
    icon: NotebookPen,
    blurb: "How you like your videos, in your own words.",
  },
  {
    id: "agents",
    href: "/settings/agents",
    label: "Agents and models",
    icon: Cpu,
    blurb: "Which agent does which work, and the keys it searches with.",
  },
  {
    id: "packs",
    href: "/settings/packs",
    label: "Packs",
    icon: Package,
    blurb: "Templates, rules, glossary and assets that travel together.",
  },
] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

export const settingsSection = (id: string) => SETTINGS_SECTIONS.find((s) => s.id === id)!;


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
 * the one line of what it is are the glossary's, and this page adds the brand kit.
 *
 * A project whose plan names the subject inherits that kit when the plan is applied,
 * under any override the project or a rule sets. A rule can say it is about the
 * subject, and those rules are listed here so a subject reads as one thing.
 *
 * Not modelled yet: assets that belong to a subject. A library image named after it
 * is still found by name, which is how the picture search has always worked.
 */
export const EMPTY_KIT: NonNullable<GlossaryTerm["brand"]> = {
  palette: { primary: "", secondary: "", text: "", background: "" },
  fonts: { captions: "", titles: "" },
  logo: { slot: "", assetId: "" },
};
