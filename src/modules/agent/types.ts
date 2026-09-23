import type { taskSelections, ResolvedSelection, Selection } from "./server/selection";
import type { HarnessStatus } from "./server/detect";
import type { Message, LogEvent, Attachment } from "../../common/api/client";
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
  /** A ceiling on the whole run. Silence, not wall-clock time, is what ends a working agent. */
  timeoutMs?: number;
  /** How long the harness may say nothing before it is treated as hung. */
  idleMs?: number;
  /**
   * True while the host is running a tool this agent asked for. A transcription or a
   * render takes many minutes, and the agent is silent for all of them because it is
   * waiting on us — silence like that is not a hang.
   */
  busy?: () => boolean;
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


/**
 * Every place the app asks the user to write a prompt.
 *
 * The harness picker is part of this component rather than something each
 * surface remembers to add, which is the whole point: a new prompt surface gets
 * the choice for free, and there is no second place where a prompt can be sent
 * to whichever CLI happened to be first on PATH.
 *
 * The composer does not know what the prompt means. It hands `onSend` the text
 * and gets out of the way — which harness runs it is already saved server-side,
 * so the caller does not have to thread the selection through either.
 */
export type PromptComposerHandle = { focus: () => void };


export type TemplateSummary = { id: string; name: string; description: string; tags: string[]; builtin: boolean };


/** One kind of work, what it resolves to today, and whether that is its own choice. */
export type TaskSelection = ReturnType<typeof taskSelections>[number];


/**
 * One copy of "which harnesses exist and which one is picked", shared by every
 * prompt surface in the app.
 *
 * A module-level store rather than a context provider, deliberately. The picker
 * has to be droppable into any composer — the editor chat, the onboarding
 * interview, the welcome screen, a rules panel — and requiring each of those to
 * be wrapped in a provider is how you end up with two of them out of sync, or
 * with a surface that silently cannot show the picker at all. Here, mounting
 * the component is the whole integration.
 *
 * Detection spawns nothing on the client; it is one GET. But it is one GET per
 * scope, cached, so five composers on a page cost one request.
 */
export type AgentsSnapshot = {
  harnesses: HarnessStatus[];
  selection: ResolvedSelection;
  override: Selection | null;
  workspaceDefault: Selection | null;
  /** Model per task (decision 50). Workspace-wide, so it is the same list in every scope. */
  tasks: TaskSelection[];
  loading: boolean;
  error: string;
};


/**
 * What a chat needs, whatever it is chatting about.
 *
 * The panel in the editor and the empty window on the home page are the same
 * component; they differ only in where the turns come from and what sending one
 * does. A controller is that difference, and nothing else, so a third surface is a
 * third controller rather than a second chat.
 */
export type ChatController = {
  /** Scopes the harness picker and the attachment uploads. Absent before a project exists. */
  projectId?: string;
  messages: Message[];
  events: LogEvent[];
  working: boolean;
  workingLabel: string;
  stage?: string | null;
  elapsed: number;
  progress?: number;
  /** The last turn was never answered and nothing is running. */
  interrupted: boolean;
  canStop: boolean;
  error: string;
  attachments: Attachment[];
  attaching: boolean;
  attach: (files: File[]) => void;
  removeAttachment: (id: string) => void;
  send: (text: string) => Promise<void>;
  stop?: () => void;
  undo?: (messageId: number) => void;
  placeholder: string;
  lockedReason?: string;
};


/**
 * The chat with no project behind it yet.
 *
 * A message, a link or a dropped video are all legitimate ways to start: the first
 * turn decides which, creates the project through the same endpoints the cards on the
 * home page use, and hands the conversation over to the editor. Nothing is edited
 * here — this window's whole job is to turn what somebody said into a project that
 * already knows what they want.
 */
/** What the home screen decided before a word was typed: the shape, and the look. */
export type StartOptions = { aspect?: string; templateIds?: string[] };
