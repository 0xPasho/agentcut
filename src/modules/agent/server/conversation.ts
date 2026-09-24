import { q, type MessageRow } from "../../../common/server/db";
import type { AgentEvent, AgentProvider } from "./providers";
import { runEditorAgent, type ConversationTurn, type MessageContext } from "./editor-agent";
import { editProject, readEditor, RevisionConflict } from "../../editor/server/store";
import { invertOperations } from "../../editor/lib/history";
import { jobStopped } from "../../project/server/reaper";
import type { EditorOperation } from "../../editor/lib/operations";

/**
 * What an agent turn did to the project, and how to take it back. The inverse is
 * computed against the project as it stood before the run, in the shared operation
 * vocabulary, so undoing a message is an ordinary revision-checked edit — one
 * history entry for the whole turn.
 */
export type MessageChanges = {
  revisionBefore: number;
  revisionAfter: number;
  operations: number;
  inverse: EditorOperation[];
  undone: boolean;
};

/**
 * A project has one conversation, whichever interface speaks: the web panel, the
 * CLI, a terminal agent over MCP, and the editing agent itself all write to the
 * same table. Every editing run receives the recent turns, so "make it like the
 * last one" means something.
 */

const HISTORY_TURNS = 30;
const HISTORY_CHARS = 12_000;

export type Message = {
  id: number; role: MessageRow["role"]; source: MessageRow["source"]; text: string;
  sequenceId: string | null; context: MessageContext | null; jobId: string | null; at: number;
  changes: Omit<MessageChanges, "inverse"> | null;
};

const fromRow = (m: MessageRow): Message => {
  const changes = m.changes ? (JSON.parse(m.changes) as MessageChanges) : null;
  return {
    id: m.id, role: m.role, source: m.source, text: m.text, sequenceId: m.sequence_id,
    context: m.context ? (JSON.parse(m.context) as MessageContext) : null, jobId: m.job_id, at: m.at,
    changes: changes ? { revisionBefore: changes.revisionBefore, revisionAfter: changes.revisionAfter, operations: changes.operations, undone: changes.undone } : null,
  };
};

export function readConversation(projectId: string, limit = 50): Message[] {
  return q.messages(projectId, limit).map(fromRow);
}

export function recordMessage(projectId: string, m: { role: MessageRow["role"]; source: MessageRow["source"]; text: string; sequenceId?: string; context?: MessageContext; jobId?: string }): Message {
  if (!q.getProject(projectId)) throw new Error("Project not found");
  const at = Date.now();
  const sequenceId = m.sequenceId ?? m.context?.sequenceId ?? null;
  const id = q.insertMessage({
    project_id: projectId, role: m.role, source: m.source, text: m.text, sequence_id: sequenceId,
    context: m.context ? JSON.stringify(m.context) : null, job_id: m.jobId ?? null, changes: null, at,
  });
  return { id, role: m.role, source: m.source, text: m.text, sequenceId, context: m.context ?? null, jobId: m.jobId ?? null, at, changes: null };
}

/** Recent turns, trimmed from the oldest so a long thread never crowds out the material. */
export function historyFor(projectId: string): ConversationTurn[] {
  const turns = readConversation(projectId, HISTORY_TURNS).map((m) => ({ role: m.role, text: m.text, at: m.at, source: m.source }));
  let total = 0;
  const kept: ConversationTurn[] = [];
  for (const turn of [...turns].reverse()) {
    total += turn.text.length;
    if (total > HISTORY_CHARS) break;
    kept.unshift(turn);
  }
  return kept;
}

export type SendOptions = {
  source?: MessageRow["source"]; sequenceId?: string; context?: MessageContext; jobId?: string;
  provider?: string; model?: string; runner?: AgentProvider; onEvent?: (e: AgentEvent) => void;
};

/** Record the instruction, run the editing agent with the thread behind it, record its reply. */
export async function sendMessage(projectId: string, text: string, o: SendOptions = {}) {
  const history = historyFor(projectId);
  const context = { ...(o.context ?? {}), ...(o.sequenceId ? { sequenceId: o.sequenceId } : {}) };
  const sent = recordMessage(projectId, { role: "user", source: o.source ?? "web", text, sequenceId: o.sequenceId, context, jobId: o.jobId });
  const before = readEditor(projectId);
  try {
    const result = await runEditorAgent(projectId, text, { provider: o.provider, model: o.model, runner: o.runner, onEvent: o.onEvent, history, context, author: `agent:${sent.id}` });
    const reply = recordMessage(projectId, { role: "agent", source: "agent", text: result.text.trim() || "(no reply)", sequenceId: o.sequenceId, jobId: o.jobId });
    if (result.operations.length) {
      const after = readEditor(projectId);
      // The inverse is only honest if nothing else wrote in between: one revision per edit call the run made.
      let inverse: EditorOperation[] = [];
      try { inverse = invertOperations(before.edl, result.operations); } catch { inverse = []; }
      const changes: MessageChanges = { revisionBefore: before.revision, revisionAfter: after.revision, operations: result.operations.length, inverse, undone: false };
      q.setMessageChanges(reply.id, JSON.stringify(changes));
      reply.changes = { revisionBefore: changes.revisionBefore, revisionAfter: changes.revisionAfter, operations: changes.operations, undone: false };
    }
    return { sent, reply, result };
  } catch (error) {
    // A stopped run is not a failure, and saying "Failed: claude was stopped" to the
    // person who pressed Stop is both wrong and alarming. What it had already saved
    // stays saved, so the turn says so rather than pretending nothing happened.
    const text = jobStopped()
      ? "Stopped. Anything it had already saved is still in the project."
      : `Failed: ${(error as Error).message}`;
    recordMessage(projectId, { role: "agent", source: "agent", text, sequenceId: o.sequenceId, jobId: o.jobId });
    throw error;
  }
}

/** Take back everything one agent turn did, as one revision-checked edit. Later edits must be undone first. */
export async function undoMessage(projectId: string, messageId: number, expectedRevision?: number) {
  const row = q.getMessage(messageId);
  if (!row || row.project_id !== projectId) throw new Error("Message not found");
  const changes = row.changes ? (JSON.parse(row.changes) as MessageChanges) : null;
  if (!changes || !changes.operations) throw new Error("This message changed nothing.");
  if (changes.undone) throw new Error("This message has already been undone.");
  if (!changes.inverse.length) throw new Error("This message's changes cannot be inverted automatically. Undo them by hand.");
  const current = readEditor(projectId);
  if (expectedRevision !== undefined && current.revision !== expectedRevision) throw new RevisionConflict(current);
  if (current.revision !== changes.revisionAfter) throw new Error(`The project has changed since this message (revision ${current.revision}, was ${changes.revisionAfter}). Undo the later changes first.`);
  const saved = editProject(projectId, { expectedRevision: current.revision, operations: changes.inverse }, { actor: "human" });
  q.setMessageChanges(messageId, JSON.stringify({ ...changes, undone: true }));
  recordMessage(projectId, { role: "user", source: "web", text: `Undid the agent's changes from message ${messageId}.`, sequenceId: row.sequence_id ?? undefined });
  return { revision: saved.revision, reverted: changes.operations };
}
