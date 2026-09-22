import { q } from "../../../common/server/db";
import { jobState, type ProjectDetail } from "../../../common/api/client";
import { readEditor } from "../../editor/server/store";
import { onboardingState } from "../../onboarding/server/onboarding";
import { projectSummary } from "../lib/summary";
import { renderedClips } from "./clip-files";
import { reapDeadJobs } from "./reaper";

/**
 * What each page needs from the workspace, read on the server. The routes in `src/app`
 * only call these and hand the result to a view, so no page reads the database itself.
 * `null` is "no such project" — the route turns it into a 404.
 */

export async function loadHome() {
  const onboarding = await onboardingState();
  return { projects: q.listProjects().map(projectSummary), onboarding };
}

export async function loadProjectDetail(id: string): Promise<ProjectDetail | null> {
  reapDeadJobs(id);
  const p = q.getProject(id);
  if (!p) return null;
  return {
    id: p.id,
    name: p.name,
    status: p.status,
    error: p.error,
    sourcePath: p.source_path,
    probe: p.probe ? JSON.parse(p.probe) : null,
    revision: p.revision,
    edl: p.edl ? readEditor(id).edl : null,
    rendered: Object.keys(await renderedClips(id)),
    job: jobState(q.latestJob(id)),
  };
}

/** The editor's first state. `"no-edl"` is a project that has nothing to edit yet. */
export async function loadEditor(id: string) {
  reapDeadJobs(id);
  const p = q.getProject(id);
  if (!p) return null;
  if (!p.edl) return "no-edl" as const;
  const snapshot = readEditor(id);
  return {
    id, name: p.name, sourcePath: p.source_path, status: p.status, error: p.error,
    probe: p.probe ? JSON.parse(p.probe) : null, ...snapshot,
    rendered: Object.keys(await renderedClips(id)), job: jobState(q.latestJob(id)),
  };
}

/**
 * One clip or timeline of a project. The shared reader repairs word timings saved before
 * cutting clamped them; parsing the row directly hands the browser a state that fails
 * validation on its very first edit.
 */
export function loadClipEditor(id: string, clipId: string) {
  const project = q.getProject(id);
  if (!project?.edl) return null;
  const { edl, revision } = readEditor(id);
  if (!edl.clips.some((c) => c.id === clipId) && !edl.sequences.some((s) => s.id === clipId)) return null;
  return { projectId: id, projectName: project.name, edl, revision, clipId };
}
