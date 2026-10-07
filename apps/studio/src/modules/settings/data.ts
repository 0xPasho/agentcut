import { BookA, Cpu, Images, LayoutTemplate, Monitor, Package, Scale, UserRound, CalendarDays, Send, type LucideIcon } from "lucide-react";
import type { WorkspaceIcon } from "@agentcut/core/modules/settings/types";

/** The rail's marks, by the name core gives each section. */
export const SECTION_ICONS: Record<WorkspaceIcon, LucideIcon> = {
  calendar: CalendarDays, publishing: Send, library: Images, profile: UserRound, rules: Scale,
  glossary: BookA, packs: Package, templates: LayoutTemplate, agents: Cpu, machine: Monitor,
};
