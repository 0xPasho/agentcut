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

  searchImages: (q: string) =>
    fetch(`/api/search/images?q=${encodeURIComponent(q)}`).then(json<{ hits: SearchHit[] }>),

  adoptHit: (hit: SearchHit, projectId: string) =>
    fetch("/api/search/images", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hit, projectId }),
    }).then(json<{ asset: AssetSummary }>),

  uploadAsset: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return fetch("/api/assets", { method: "POST", body: form }).then(json<{ asset: AssetSummary }>);
  },

  deleteAsset: (id: string) =>
    fetch(`/api/assets?id=${encodeURIComponent(id)}`, { method: "DELETE" }).then(json<{ ok: true }>),

  listAssets: (kind: string, projectId: string) =>
    fetch(`/api/assets?kind=${kind}&projectId=${projectId}`).then(json<{ assets: AssetSummary[] }>),

  captureFrame: (id: string, atSec: number) =>
    fetch(`/api/projects/${id}/asset`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ atSec }),
    }).then(json<{ name: string }>),

  render: (id: string, only?: string[]) =>
    fetch(`/api/projects/${id}/render`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ only }),
    }).then(json<{ job: JobState }>),
};

export const assetFileUrl = (id: string) => `/api/assets/${id}/file`;

export const assetUrl = (projectId: string, ref: string) =>
  // An asset id resolves through the library route; a bare filename is an older
  // EDL pointing at the project's own assets folder.
  ref.startsWith("a_")
    ? `/api/assets/${ref}/file`
    : `/api/projects/${projectId}/asset/${encodeURIComponent(ref)}`;

export type SearchHit = {
  provider: string;
  id: string;
  title: string;
  url: string;
  thumbUrl: string;
  pageUrl: string;
  license: string;
  creator?: string;
  width: number;
  height: number;
  relevance: number;
};

export type AssetSummary = {
  id: string;
  kind: string;
  name: string;
  license: string | null;
  attribution: string | null;
  width: number | null;
  height: number | null;
  duration_sec: number | null;
};

export const sourceUrl = (id: string) => `/api/projects/${id}/source`;
export const thumbUrl = (id: string, clipId: string) =>
  `/api/projects/${id}/clips/${clipId}/thumb`;
export const clipUrl = (id: string, clipId: string) => `/api/projects/${id}/clips/${clipId}/file`;
