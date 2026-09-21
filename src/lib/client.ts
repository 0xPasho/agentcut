import type { EditorOperation, EditorSnapshot } from "./editor/operations";
import type { Edl } from "./edl";
import type { Probe } from "./media";
import type { MessageContext } from "./editor/agent";
import type { Message } from "./editor/conversation";
export type { MessageContext, Message };

export type ProjectSummary = {
  id: string;
  name: string;
  status: string;
  createdAt: number;
  clipCount: number;
  sequenceCount?: number;
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
  revision: number;
  rendered: string[];
  job: JobState | null;
};

export type LogEvent = { id: number; kind: string; name: string | null; text: string; at: number };

export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new ApiError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? res.statusText, res.status);
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

  /** Several raw videos → one project, one video each, batch started. */
  createBatch: (name: string, files: File[], brief: string) => {
    const form = new FormData();
    form.append("name", name); form.append("brief", brief);
    for (const file of files) form.append("files", file);
    return fetch("/api/projects/batch", { method: "POST", body: form }).then(json<{ id: string; name: string; job: JobState }>);
  },
  runBatch: (id: string, options: { brief?: string; force?: boolean } = {}) =>
    fetch(`/api/projects/${id}/batch`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(options) }).then(json<{ job: JobState }>),

  getProject: (id: string) => fetch(`/api/projects/${id}`).then(json<ProjectDetail>),

  deleteProject: (id: string) => fetch(`/api/projects/${id}`, { method: "DELETE" }).then(json<{ ok: true }>),

  edit: (id: string, expectedRevision: number, operations: EditorOperation[]) =>
    fetch(`/api/projects/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedRevision, operations }),
    }).then(json<EditorSnapshot>),

  agentEdit: (id: string, instruction: string, expectedRevision: number, context?: MessageContext) =>
    fetch(`/api/projects/${id}/edit`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ instruction, expectedRevision, sequenceId: context?.sequenceId, context }) }).then(json<{ job: JobState }>),

  undoMessage: (id: string, messageId: number, expectedRevision?: number) =>
    fetch(`/api/projects/${id}/editor`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tool: "conversation.undo", messageId, expectedRevision }) }).then(json<{ revision: number; reverted: number }>),

  messages: (id: string, limit = 50) => fetch(`/api/projects/${id}/messages?limit=${limit}`).then(json<{ messages: Message[] }>),

  /** Workspace-level rules, glossary and preferences, when no project is open. */
  workspace: <T>(body?: Record<string, unknown>) =>
    (body
      ? fetch("/api/workspace", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      : fetch("/api/workspace")).then(json<T>),

  editorTool: <T>(id: string, call: unknown) =>
    fetch(`/api/projects/${id}/editor`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(call) }).then(json<T>),

  analyze: (id: string, options: Record<string, unknown>) =>
    fetch(`/api/projects/${id}/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(options),
    }).then(json<{ job: JobState }>),

  /** Re-recognise the source audio and refresh the words on every clip cut from it. */
  resyncTranscript: (id: string, options: Record<string, unknown> = {}) =>
    fetch(`/api/projects/${id}/transcribe`, {
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

  captureFrame: (id: string, atSec: number, mediaId?: string) =>
    fetch(`/api/projects/${id}/asset`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ atSec, mediaId }),
    }).then(json<{ name: string }>),

  render: (id: string, only?: string[], expectedRevision?: number) =>
    fetch(`/api/projects/${id}/render`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ only, expectedRevision }),
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
  in_project?: number;
  scope?: "library" | "project";
  project_id?: string | null;
  id: string;
  kind: string;
  name: string;
  /** Workspace-relative file path. Present on rows the asset tools return. */
  path?: string;
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
