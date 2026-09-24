import type { ProjectVideo } from "./overview";
import type { MakeChoice } from "../types";

export const editHref = (projectId: string, video: ProjectVideo) =>
  video.kind === "sequence" ? `/p/${projectId}/edit?sequence=${video.id}` : `/p/${projectId}/c/${video.id}`;

/**
 * The analyse request behind a choice. Only what the person actually decided is sent, so
 * the template's own numbers stay in force for everything they did not touch — a form
 * that posted its defaults would quietly overrule the document it just chose.
 */
export function analyzeOptions(make: MakeChoice, brief: string): Record<string, unknown> {
  const options: Record<string, unknown> = { userBrief: brief };
  if (make.templateId) options.templateId = make.templateId;
  if (make.mode === "section") {
    if (make.minutes > 0) options.selection = { targetSec: make.minutes * 60 };
    return options;
  }
  options.targetClipCount = make.count;
  return options;
}
