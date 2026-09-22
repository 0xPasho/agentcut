import type { SequenceStatus } from "../plan/types";
/** How a project's status reads as a badge. */
export const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  ready: "secondary",
  error: "destructive",
  new: "outline",
};

/**
 * The shapes the home screen offers, by name. Choosing one is a decision about the video
 * being made; without one the project takes the shape of its first source.
 */
export const ASPECTS: Record<string, { width: number; height: number; fps: number }> = {
  "9:16": { width: 1080, height: 1920, fps: 30 },
  "4:5": { width: 1080, height: 1350, fps: 30 },
  "1:1": { width: 1080, height: 1080, fps: 30 },
  "16:9": { width: 1920, height: 1080, fps: 30 },
};


/**
 * Status reads as a dot plus its word, never as a colour on its own: four states
 * told apart by hue alone are four states nobody can tell apart.
 */
export const STATUS: Record<SequenceStatus, { label: string; dot: string }> = {
  pending: { label: "Pending", dot: "bg-transparent ring-1 ring-inset ring-muted-foreground" },
  edited: { label: "Edited", dot: "bg-muted-foreground" },
  approved: { label: "Approved", dot: "bg-primary" },
  rendered: { label: "Rendered", dot: "bg-primary" },
};


export const BUSY = new Set(["download", "probe", "transcribe", "signals", "agent", "rendering", "bundling"]);


export const STATUSES: SequenceStatus[] = ["pending", "edited", "approved", "rendered"];


export const FILTERS: Array<{ value: SequenceStatus | "all"; label: string }> = [
  { value: "all", label: "All" },
  ...STATUSES.map((value) => ({ value, label: STATUS[value].label })),
];
