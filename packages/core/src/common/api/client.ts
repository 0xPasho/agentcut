import type { EditorOperation, EditorSnapshot } from "../../modules/editor/lib/operations";
import type { Edl } from "../../modules/editor/types";
import type { Probe } from "../../modules/media/server/ffmpeg";
import type { Attachment, MessageContext } from "../../modules/agent/server/editor-agent";
import type { Message } from "../../modules/agent/server/conversation";
import type { JobState } from "../../modules/project/lib/job-state";
import type { FilesResponse } from "../../modules/media/server/local-assets";
import type { ResolvedLocalFile } from "../../modules/media/types";
import type { SnapshotExport, SnapshotImport, SnapshotPreview } from "../../modules/settings/types";
export type { Attachment, MessageContext, Message };
export { JOB_ACTIVE, jobState, type JobState } from "../../modules/project/lib/job-state";

export type ProjectSummary = {
  id: string;
  name: string;
  status: string;
  createdAt: number;
  clipCount: number;
  sequenceCount?: number;
  thumbnailPath?: string;
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

export type LogEvent = { id: number; kind: string; name: string | null; text: string; at: number; jobId?: string | null };

/** The first-run interview, as both the web flow and the agent see it. */
export type OnboardingQuestion = { id: string; label: string; placeholder: string; required: boolean };
export type OnboardingState = {
  status: "pending" | "skipped" | "done";
  done: boolean;
  skipped: boolean;
  hasPreferences: boolean;
  reminder: boolean;
  answers: Record<string, string>;
  remaining: string[];
  questions?: readonly OnboardingQuestion[];
};
export type OnboardingResult = { preferences: string; glossary: Array<{ term: string }>; usedAgent: boolean; answers: Record<string, string> };

export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new ApiError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? res.statusText, res.status);
  return res.json() as Promise<T>;
}

export const api = {
  exportSnapshot: () => fetch("/api/workspace/snapshot", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "export" }) }).then(json<SnapshotExport>),
  previewSnapshot: (file: File) => fetch("/api/workspace/snapshot?action=upload", { method: "POST", headers: { "Content-Type": "application/gzip" }, body: file }).then(json<{ id: string; preview: SnapshotPreview }>),
  restoreSnapshot: (id: string, fingerprint: string) => fetch("/api/workspace/snapshot", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "restore", id, fingerprint, confirm: "replace-workspace-data" }) }).then(json<SnapshotImport>),
  listProjects: () => fetch("/api/projects").then(json<{ projects: ProjectSummary[] }>),

  createProject: (source: string) =>
    fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source }),
    }).then(json<{ id: string; name: string }>),

  /**
   * A dropped file, sent as the raw request body rather than a multipart form: the server
   * writes it straight to disk, so a long recording is never held in memory whole. Prefer
   * `createProject` with a path when one is known — that clones instead of copying.
   * `ingest.ts` beside this file is what decides between the two; call that.
   */
  uploadProject: (file: File) =>
    fetch("/api/projects", {
      method: "POST",
      headers: { "content-type": file.type || "application/octet-stream", "x-file-name": encodeURIComponent(file.name) },
      body: file,
    }).then(json<{ id: string; name: string }>),

  /**
   * Where on this machine a file the browser handed over already lives, from the name,
   * size and modification time a `File` carries. `null` when it is not on this disk.
   */
  resolveLocalFile: (file: File, roots: string[] = []) =>
    fetch("/api/files/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: file.name, size: file.size, modifiedAt: file.lastModified, roots }),
    }).then(json<{ found: ResolvedLocalFile | null }>).then((r) => r.found),

  /** A video the browser could not name by path, streamed into a project's media. */
  uploadProjectMedia: (id: string, file: File, expectedRevision: number, transcribe?: boolean) =>
    fetch(`/api/projects/${id}/media`, {
      method: "POST",
      headers: {
        "content-type": file.type || "application/octet-stream",
        "x-file-name": encodeURIComponent(file.name),
        "x-expected-revision": String(expectedRevision),
        ...(transcribe === undefined ? {} : { "x-transcribe": transcribe ? "true" : "false" }),
      },
      body: file,
    }).then(json<{ edl: Edl }>),

  /** This machine's folders, for picking a source file without copying it anywhere. */
  browseFiles: (folder?: string, offset = 0, limit = 100) =>
    fetch(`/api/files?${new URLSearchParams({ ...(folder ? { folder } : {}), offset: String(offset), limit: String(limit) })}`).then(json<FilesResponse>),

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

  /** Hand the project back when a job is stuck; the run itself is abandoned, not cancelled. */
  unlockProject: (id: string) =>
    fetch(`/api/projects/${id}/unlock`, { method: "POST" }).then(json<{ reaped: string[]; stopped: string | null }>),

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

  /**
   * The interview's final step, with the agent's progress as it happens. Falls back
   * to nothing visible but the same result if the stream cannot be read.
   */
  runOnboarding: async (answers: Record<string, string>, onProgress?: (line: string) => void) => {
    const res = await fetch("/api/workspace/onboarding", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ answers }) });
    if (!res.ok || !res.body) throw new Error((await res.text().catch(() => "")) || "The interview could not be written.");
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let result: OnboardingResult | null = null;
    for (;;) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
      const lines = buffer.split("\n");
      buffer = done ? "" : (lines.pop() ?? "");
      for (const line of lines) {
        if (!line.trim()) continue;
        const payload = JSON.parse(line) as { kind?: string; name?: string; text?: string; done?: OnboardingResult; error?: string };
        if (payload.error) throw new Error(payload.error);
        if (payload.done) result = payload.done;
        else if (payload.text) onProgress?.(payload.name ? `${payload.name}: ${payload.text}` : payload.text);
      }
      if (done) break;
    }
    if (!result) throw new Error("The interview ended without writing preferences.");
    return result;
  },

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

  /** Bytes the browser could not name by path, streamed in. A project's asset, or the library's. */
  uploadAsset: (file: File, projectId?: string) =>
    fetch(`/api/assets${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""}`, {
      method: "POST",
      headers: { "content-type": file.type || "application/octet-stream", "x-file-name": encodeURIComponent(file.name) },
      body: file,
    }).then(json<{ asset: AssetSummary }>),

  /** A file on this machine, cloned in by path. A project's asset, or the library's. */
  importLocalAsset: (file: string, projectId?: string) =>
    fetch(`/api/assets${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file }),
    }).then(json<{ asset: AssetSummary }>),

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
  /** How it got here: upload, drop-in, starter, search, chat, or `pack:<id>`. */
  source?: string | null;
  tags?: string | null;
  created_at?: number;
};

export const sourceUrl = (id: string) => `/api/projects/${id}/source`;
/**
 * The poster is cached `immutable`, so the revision has to travel in the URL:
 * without it a trim leaves the old frame on screen until the browser is cleared.
 */
export const thumbUrl = (id: string, clipId: string, revision?: number) =>
  `/api/projects/${id}/clips/${clipId}/thumb${revision ? `?v=${revision}` : ""}`;
export const clipUrl = (id: string, clipId: string) => `/api/projects/${id}/clips/${clipId}/file`;
