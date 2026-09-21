import { db } from "../db";

/**
 * Whether a newly imported source recognises itself.
 *
 * Silent, unbounded whisper runs on somebody's laptop are not acceptable, and
 * neither is a project whose captions, glossary, silence cuts and beats are blind
 * on the footage that was just added. So the default is on, and bounded:
 *
 * - `audio` (the default) transcribes a new source only when it has an audio track
 *   carrying something. A file with no audio stream is skipped for free, and one
 *   whose audio is effectively silence is skipped after a cheap decode — a fraction
 *   of what the recogniser would cost.
 * - `always` transcribes every imported source, silence included.
 * - `off` transcribes nothing on import. Every source is still one click or one
 *   `media.transcribe` away, and the skip is recorded with its reason rather than
 *   leaving the media looking like it has no speech.
 *
 * Workspace wide, with a per-project override, stored in the same `settings` table
 * the harness selection uses — the server is what runs the recogniser, so a browser
 * preference would be a lie for every MCP and CLI import.
 */
export const TRANSCRIBE_MODES = ["audio", "always", "off"] as const;
export type TranscribeMode = (typeof TRANSCRIBE_MODES)[number];

db.exec(`CREATE TABLE IF NOT EXISTS settings (
  scope TEXT NOT NULL,
  key   TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (scope, key)
)`);

const KEY = "transcribe.onImport";
const WORKSPACE_SCOPE = "workspace";
const scopeFor = (projectId?: string) => (projectId ? `project:${projectId}` : WORKSPACE_SCOPE);

export const DEFAULT_TRANSCRIBE_MODE: TranscribeMode = "audio";

const valid = (value: unknown): TranscribeMode | null =>
  typeof value === "string" && (TRANSCRIBE_MODES as readonly string[]).includes(value) ? (value as TranscribeMode) : null;

function read(scope: string): TranscribeMode | null {
  const row = db.prepare("SELECT value FROM settings WHERE scope = ? AND key = ?").get(scope, KEY) as { value: string } | undefined;
  return row ? valid(row.value) : null;
}

/** The raw stored value for one scope, so a settings form never shows inherited state as its own. */
export const storedTranscribeMode = (projectId?: string): TranscribeMode | null => read(scopeFor(projectId));

/** Save a mode, or clear it (`null`) so the scope inherits again. */
export function saveTranscribeMode(mode: TranscribeMode | null, projectId?: string): void {
  const scope = scopeFor(projectId);
  if (mode === null) { db.prepare("DELETE FROM settings WHERE scope = ? AND key = ?").run(scope, KEY); return; }
  if (!valid(mode)) throw new Error(`Choose one of: ${TRANSCRIBE_MODES.join(", ")}`);
  db.prepare("INSERT INTO settings (scope, key, value) VALUES (?, ?, ?) ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value").run(scope, KEY, mode);
}

export type ResolvedTranscribeMode = { mode: TranscribeMode; scope: "env" | "project" | "workspace" | "default" };

/**
 * What is in force for a project. `AGENTCUT_TRANSCRIBE_ON_IMPORT` wins over both
 * scopes: it is how a test run, a CI machine or a headless batch says "not here",
 * and a stored preference should not be able to start a model download under it.
 */
export function resolveTranscribeMode(projectId?: string): ResolvedTranscribeMode {
  const env = valid(process.env.AGENTCUT_TRANSCRIBE_ON_IMPORT) ?? (process.env.AGENTCUT_TRANSCRIBE_ON_IMPORT === "0" ? "off" : null);
  if (env) return { mode: env, scope: "env" };
  // A test run imports a lot of footage and must never start a model download on
  // somebody's machine as a side effect. A test that is about this path says so
  // with the variable above, which still wins here.
  if (process.env.NODE_TEST_CONTEXT) return { mode: "off", scope: "env" };
  const project = projectId ? read(scopeFor(projectId)) : null;
  if (project) return { mode: project, scope: "project" };
  const workspace = read(WORKSPACE_SCOPE);
  if (workspace) return { mode: workspace, scope: "workspace" };
  return { mode: DEFAULT_TRANSCRIBE_MODE, scope: "default" };
}

/** Everything a settings surface needs, for the human panel and the agent tool alike. */
export function transcribeSettings(projectId?: string) {
  return {
    effective: resolveTranscribeMode(projectId),
    workspace: read(WORKSPACE_SCOPE),
    project: projectId ? read(scopeFor(projectId)) : null,
    modes: [...TRANSCRIBE_MODES],
  };
}
