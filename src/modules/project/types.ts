import type { ProjectVideo } from "./lib/overview";

export type ClipListHandlers = {
  onSelect: (id: string) => void;
  onOpen: (video: ProjectVideo) => (event: React.MouseEvent) => void;
  onApprove: (video: ProjectVideo) => void;
  onDelete: (video: ProjectVideo) => void;
  href: (video: ProjectVideo) => string;
};

/**
 * What the analyse form is asking the agent for. `mode` is the template's own word for
 * the kind of video it makes — a pack of clips, or one long one cut from a section — and
 * the rest is the one number that kind needs.
 */
export type MakeChoice = {
  mode: "clips" | "section";
  /** Empty means "no template": clips as the agent finds them, which is the old default. */
  templateId: string;
  count: number;
  /** A section's running time. 0 means "whatever the template asks for". */
  minutes: number;
};
