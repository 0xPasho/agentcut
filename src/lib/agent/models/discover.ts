import { spawn } from "node:child_process";
import type { ChildProcess, ChildProcessWithoutNullStreams } from "node:child_process";
import type { Readable } from "node:stream";
import { spawnable } from "../binary";
import type { HarnessId } from "../registry";
import type { ModelInfo } from "./catalog";

/**
 * Ask each CLI for its own model list.
 *
 *   claude    `claude -p --input-format stream-json` → initialize control_request → `models`
 *   codex     `codex app-server` → JSON-RPC `initialize` → `model/list` (paginated)
 *   cursor    `cursor-agent models` → "<slug> - <Display Name>" lines
 *   opencode  `opencode models` → "<provider>/<model>" lines
 *
 * Two of these are plain subcommands and two need a handshake. All four are
 * bounded by a timeout and always kill their child, because this runs from a
 * UI affordance and a hung probe must not become a leaked process.
 *
 * Every parser is exported separately from its transport so the shapes can be
 * tested without a CLI on the machine.
 */

/** Whole-probe budget. A cold `codex app-server` takes seconds; this always runs behind the cache. */
export const DISCOVERY_TIMEOUT_MS = 25_000;

/** Safety net on codex's cursor pagination. */
const CODEX_PAGE_LIMIT = 10;

/** What the helpers below actually touch. The two subcommand probes never write
 *  to their child, so typing them as fully-piped would be a lie about stdin. */
type ProbeChild = Pick<ChildProcess, "kill" | "on"> & { stdout: Readable; stderr: Readable };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function kill(child: ProbeChild): void {
  try {
    child.kill("SIGKILL");
  } catch {
    // already gone
  }
}

function withTimeout<T>(work: Promise<T>, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${DISCOVERY_TIMEOUT_MS / 1000}s`)),
      DISCOVERY_TIMEOUT_MS,
    );
    work.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error: unknown) => { clearTimeout(timer); reject(error instanceof Error ? error : new Error(String(error))); },
    );
  });
}

/**
 * A spawn that never starts (missing binary → ENOENT) emits `error`, not
 * `exit`. Without a listener that is a process-level uncaught exception, so
 * every probe races its work against this.
 */
function spawnFailure(child: ProbeChild): Promise<never> {
  return new Promise((_resolve, reject) => { child.on("error", (error: Error) => reject(error)); });
}

/** Read a child's stdout to completion, as text. */
function collectStdout(child: ProbeChild): Promise<string> {
  return new Promise((resolve, reject) => {
    let out = "";
    let err = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { out += chunk; });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => { err += chunk; });
    child.on("close", (code) => {
      if (code === 0 || out.trim()) resolve(out);
      else reject(new Error(err.trim().split("\n").slice(-3).join("\n") || `exited ${code}`));
    });
  });
}

/** Line-delimited JSON over a child's stdio, for the two handshake probes. */
function lineReader(child: ProbeChild, onMessage: (msg: unknown) => void): void {
  let buf = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    buf += chunk;
    let nl: number;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (!line.trim()) continue;
      try { onMessage(JSON.parse(line)); } catch { /* the CLI also logs plain text here */ }
    }
  });
}

// -----------------------------------------------------------------------------
// claude
// -----------------------------------------------------------------------------

/**
 * The `initialize` control response carries the picker rows the CLI itself
 * shows: `value` is what `--model` takes, `resolvedModel` is what it becomes.
 * We key on `value`, not `resolvedModel` — passing the resolved id back would
 * drop the context-window suffix the alias carries (`opus[1m]`).
 */
export function parseClaudeModels(response: unknown): ModelInfo[] {
  const inner = isRecord(response) ? response.response : undefined;
  const nested = isRecord(inner) ? inner.response : undefined;
  const rows = isRecord(nested) ? nested.models : undefined;
  if (!Array.isArray(rows)) return [];
  const models: ModelInfo[] = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const id = typeof row.value === "string" ? row.value : undefined;
    if (!id) continue;
    models.push({
      id,
      ...(typeof row.displayName === "string" ? { displayName: row.displayName } : {}),
      ...(typeof row.description === "string" ? { description: row.description } : {}),
      ...(id === "default" ? { recommended: true } : {}),
    });
  }
  return models;
}

async function discoverClaude(): Promise<ModelInfo[]> {
  const child = spawn(
    spawnable("claude"),
    ["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose"],
    { stdio: ["pipe", "pipe", "pipe"] },
  ) as ChildProcessWithoutNullStreams;
  try {
    const answer = new Promise<ModelInfo[]>((resolve) => {
      lineReader(child, (msg) => {
        if (isRecord(msg) && msg.type === "control_response") resolve(parseClaudeModels(msg));
      });
    });
    child.stdin.write(
      `${JSON.stringify({ type: "control_request", request_id: "models", request: { subtype: "initialize" } })}\n`,
    );
    return await Promise.race([answer, spawnFailure(child)]);
  } finally {
    kill(child);
  }
}

// -----------------------------------------------------------------------------
// codex
// -----------------------------------------------------------------------------

export function parseCodexPage(response: unknown): { models: ModelInfo[]; nextCursor?: string } {
  const result = isRecord(response) ? response.result : undefined;
  const rows = isRecord(result) ? result.data : undefined;
  const models: ModelInfo[] = [];
  if (Array.isArray(rows)) {
    for (const row of rows) {
      if (!isRecord(row)) continue;
      if (row.hidden === true) continue;
      const id = typeof row.id === "string" ? row.id : typeof row.model === "string" ? row.model : undefined;
      if (!id) continue;
      models.push({
        id,
        ...(typeof row.displayName === "string" ? { displayName: row.displayName } : {}),
        ...(typeof row.description === "string" ? { description: row.description } : {}),
        ...(row.isDefault === true ? { recommended: true } : {}),
      });
    }
  }
  const cursor = isRecord(result) && typeof result.nextCursor === "string" ? result.nextCursor : undefined;
  return { models, ...(cursor ? { nextCursor: cursor } : {}) };
}

/**
 * Walk `model/list` until the server stops handing back a cursor. Takes the
 * request function so the pagination is testable against a fake transport.
 */
export async function collectCodexModels(
  request: (method: string, params: unknown) => Promise<unknown>,
): Promise<ModelInfo[]> {
  const models: ModelInfo[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < CODEX_PAGE_LIMIT; page += 1) {
    // `params` is required on this request — an omitted object is a protocol error.
    const response = await request("model/list", cursor ? { cursor } : {});
    const parsed = parseCodexPage(response);
    models.push(...parsed.models);
    cursor = parsed.nextCursor;
    if (!cursor) break;
  }
  return models;
}

async function discoverCodex(): Promise<ModelInfo[]> {
  const child = spawn(spawnable("codex"), ["app-server"], { stdio: ["pipe", "pipe", "pipe"] }) as ChildProcessWithoutNullStreams;
  try {
    const pending = new Map<number, (msg: unknown) => void>();
    let nextId = 0;
    lineReader(child, (msg) => {
      if (!isRecord(msg) || typeof msg.id !== "number") return;
      pending.get(msg.id)?.(msg);
      pending.delete(msg.id);
    });
    const request = (method: string, params: unknown) =>
      new Promise<unknown>((resolve) => {
        const id = (nextId += 1);
        pending.set(id, resolve);
        child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      });
    const work = (async () => {
      await request("initialize", {
        clientInfo: { name: "agentcut", title: "AgentCut", version: "1.0.0" },
      });
      return collectCodexModels(request);
    })();
    return await Promise.race([work, spawnFailure(child)]);
  } finally {
    kill(child);
  }
}

// -----------------------------------------------------------------------------
// cursor — `cursor-agent models`
// -----------------------------------------------------------------------------

/** Lines read `<slug> - <Display Name>`, under an "Available models" heading. */
export function parseCursorModels(stdout: string): ModelInfo[] {
  const models: ModelInfo[] = [];
  for (const raw of stdout.split("\n")) {
    const line = raw.trim();
    if (!line || line.toLowerCase().startsWith("available models")) continue;
    const match = /^([\w.\-[\]=,]+)\s+-\s+(.+)$/.exec(line);
    if (!match) continue;
    const [, id, display] = match;
    // The CLI marks its own pick inline; keep the name clean and use the flag.
    const isDefault = /\(.*default.*\)/i.test(display);
    models.push({
      id,
      displayName: display.replace(/\s*\([^)]*\)\s*$/, "").trim() || id,
      ...(isDefault ? { recommended: true } : {}),
    });
  }
  return models;
}

async function discoverCursor(): Promise<ModelInfo[]> {
  const child = spawn(spawnable("cursor"), ["models"], { stdio: ["ignore", "pipe", "pipe"] });
  try {
    return parseCursorModels(await Promise.race([collectStdout(child), spawnFailure(child)]));
  } finally {
    kill(child);
  }
}

// -----------------------------------------------------------------------------
// opencode — `opencode models`
// -----------------------------------------------------------------------------

/**
 * Lines are bare `provider/model` slugs, which is also exactly what `-m` takes.
 * The provider prefix becomes the description so the rows stay distinguishable
 * when two providers serve the same model name.
 */
export function parseOpencodeModels(stdout: string): ModelInfo[] {
  const models: ModelInfo[] = [];
  for (const raw of stdout.split("\n")) {
    const line = raw.trim();
    if (!line || !line.includes("/") || /\s/.test(line)) continue;
    const provider = line.slice(0, line.indexOf("/"));
    models.push({ id: line, displayName: line.slice(line.indexOf("/") + 1), description: provider });
  }
  return models;
}

async function discoverOpencode(): Promise<ModelInfo[]> {
  const child = spawn(spawnable("opencode"), ["models"], { stdio: ["ignore", "pipe", "pipe"] });
  try {
    return parseOpencodeModels(await Promise.race([collectStdout(child), spawnFailure(child)]));
  } finally {
    kill(child);
  }
}

const DISCOVERERS: Record<HarnessId, () => Promise<ModelInfo[]>> = {
  claude: discoverClaude,
  codex: discoverCodex,
  cursor: discoverCursor,
  opencode: discoverOpencode,
};

/** Live models for one harness. Throws on timeout, missing binary or a broken handshake. */
export function discoverModels(id: HarnessId): Promise<ModelInfo[]> {
  return withTimeout(DISCOVERERS[id](), `${id} model discovery`);
}
