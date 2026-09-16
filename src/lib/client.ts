import type { Edl } from "./edl";
import type { Probe } from "./media";

export type ProjectSummary = {
  id: string;
  name: string;
  status: string;
  createdAt: number;
  clipCount: number;
};

export type JobState = {
  id: string;
  kind: string;
  status: string;
  stage: string | null;
  progress: number;
};

export type ProjectDetail = {
  id: string;
  name: string;
  status: string;
  error: string | null;
  sourcePath: string;
  probe: Probe | null;
  edl: Edl | null;
  rendered: string[];
  job: JobState | null;
};

export type LogEvent = { id: number; kind: string; name: string | null; text: string; at: number };

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? res.statusText);
  return res.json() as Promise<T>;
}

export const api = {
  listProjects: () => fetch("/api/projects").then(json<{ projects: ProjectSummary[] }>),

  createProject: (source: string) =>
    fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source }),
    }).then(json<{ id: string; name: string }>),

  uploadProject: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return fetch("/api/projects", { method: "POST", body: form }).then(json<{ id: string; name: string }>);
  },

  getProject: (id: string) => fetch(`/api/projects/${id}`).then(json<ProjectDetail>),

  deleteProject: (id: string) => fetch(`/api/projects/${id}`, { method: "DELETE" }).then(json<{ ok: true }>),

  saveEdl: (id: string, edl: Edl) =>
    fetch(`/api/projects/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ edl }),
    }).then(json<{ ok: true }>),

  analyze: (id: string, options: Record<string, unknown>) =>
    fetch(`/api/projects/${id}/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(options),
    }).then(json<{ job: JobState }>),

  render: (id: string, only?: string[]) =>
    fetch(`/api/projects/${id}/render`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ only }),
    }).then(json<{ job: JobState }>),
};

export const sourceUrl = (id: string) => `/api/projects/${id}/source`;
export const thumbUrl = (id: string, clipId: string) =>
  `/api/projects/${id}/clips/${clipId}/thumb`;
export const clipUrl = (id: string, clipId: string) => `/api/projects/${id}/clips/${clipId}/file`;
