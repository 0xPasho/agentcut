export type AgentEventKind = "text" | "tool" | "log" | "error" | "result";

export type AgentEvent = {
  kind: AgentEventKind;
  /** Tool name for `tool` events. */
  name?: string;
  text: string;
  at: number;
};

export type AgentRunOptions = {
  prompt: string;
  /** Working dir. The agent must never be given access above this. */
  cwd: string;
  /** Tools to grant, in each provider's native syntax. */
  allowedTools?: string[];
  /**
   * Tools to remove from the session entirely. Required for real confinement:
   * an allowlist alone does not take anything away.
   */
  deniedTools?: string[];
  model?: string;
  timeoutMs?: number;
  onEvent?: (e: AgentEvent) => void;
};

export type AgentResult = {
  provider: string;
  text: string;
  events: AgentEvent[];
  durationMs: number;
  costUsd?: number;
  sessionId?: string;
};

export interface AgentProvider {
  readonly id: string;
  readonly label: string;
  available(): Promise<boolean>;
  run(opts: AgentRunOptions): Promise<AgentResult>;
}

/** Pull the last JSON object/array out of free-form agent output. */
export function extractJson(text: string): unknown {
  const fence = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].pop();
  const candidates = fence ? [fence[1]] : [];
  candidates.push(text);
  for (const c of candidates) {
    const trimmed = c.trim();
    try {
      return JSON.parse(trimmed);
    } catch {
      // fall through to brace scanning
    }
    const start = trimmed.search(/[[{]/);
    if (start === -1) continue;
    const open = trimmed[start];
    const close = open === "{" ? "}" : "]";
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < trimmed.length; i++) {
      const ch = trimmed[i];
      if (esc) { esc = false; continue; }
      if (ch === "\\") { esc = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === open) depth++;
      else if (ch === close && --depth === 0) {
        try {
          return JSON.parse(trimmed.slice(start, i + 1));
        } catch {
          break;
        }
      }
    }
  }
  throw new Error("no JSON found in agent output");
}
