import type { IdeaColumn } from "./types";

export const IDEA_COLUMNS: IdeaColumn[] = [
  { status: "inbox", label: "Inbox", hint: "Captured, not developed yet" },
  { status: "developing", label: "Developing", hint: "A harness is writing the brief" },
  { status: "ready", label: "Ready", hint: "Has a brief to film from" },
  { status: "production", label: "In production", hint: "Started as a project" },
  { status: "done", label: "Done", hint: "Published or let go" },
];

/** Harnesses the extension offers today. The board accepts any installed one. */
export const IDEA_HARNESSES = ["claude", "codex"] as const;

/** A brief is a short read; a harness that is still going after this has lost its way. */
export const DEVELOP_IDLE_MS = 5 * 60_000;
export const DEVELOP_MAX_MS = 20 * 60_000;

/** How much of a reference's text goes into the prompt files. The full text stays in the row. */
export const REF_TEXT_LIMIT = 6_000;

/** How often the board asks for news while a run is going. */
export const IDEAS_POLL_MS = 2_000;

/** The places the toolbar knows by default, as the library filters them. */
export const PLATFORMS = [
  { id: "x", label: "X" },
  { id: "instagram", label: "Instagram" },
  { id: "tiktok", label: "TikTok" },
  { id: "youtube", label: "YouTube" },
  { id: "web", label: "Web" },
] as const;
