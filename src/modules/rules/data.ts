import type { Rule } from "./types";

export const KIND_LABEL: Record<string, string> = { image: "picture", video: "video", audio: "sound" };

export const EMPTY_RULE: Rule = { id: "", name: "", description: "", when: "", stage: "both", priority: 100, enabled: true, then: {} };

export const STAGE_LABELS: Record<string, string> = { select: "Choosing clips", edit: "Editing", both: "Both" };
