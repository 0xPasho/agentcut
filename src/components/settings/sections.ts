import { BookA, Cpu, NotebookPen, Package, Scale, Tags } from "lucide-react";

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
