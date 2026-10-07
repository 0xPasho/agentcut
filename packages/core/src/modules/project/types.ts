import { z } from "zod";
import type { ProjectVideo } from "./lib/overview";
import type { SequenceStatus } from "../plan/types";

export const ProjectName = z.string().trim().min(1, "Enter a project name.");

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

export type VideoLayout = "list" | "grid";

/** A swipe's verdict on a video. */
export type Verdict = "approved" | "rejected";

/** One decision in a review session, kept so it can be taken back. */
export type ReviewStep = {
  id: string;
  /** The status the video had before, restored by undo. Null for a skip. */
  previous: SequenceStatus | null;
  verdict: Verdict | null;
};
