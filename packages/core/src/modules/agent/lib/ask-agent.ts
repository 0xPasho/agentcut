import type { Message } from "../server/conversation";

/**
 * Which shot the agent is working on, and what happened the last time it was asked
 * about one — read out of the conversation rather than out of whatever a panel last set.
 *
 * The conversation is the only account of this that survives: `context.selection` is
 * written with the message and kept with it, so a reload, a second window, and a run
 * started from a terminal over MCP all see the same thing. A flag held in the component
 * that sent the message sees none of them, and a spinner that lies about what is
 * happening is worse than no spinner.
 */

/** What was last asked about this shot, and the reply if one has landed. */
export function turnAbout(messages: Message[], itemId: string): { asked: Message; answer: Message | null } | null {
  for (let index = messages.length - 1; index >= 0; index--) {
    const asked = messages[index];
    if (asked.role !== "user" || !asked.context?.selection?.includes(itemId)) continue;
    return { asked, answer: messages.slice(index + 1).find(message => message.role === "agent") ?? null };
  }
  return null;
}

/**
 * The shots the turn now running is about, or none.
 *
 * A project runs one job at a time, so there is at most one open turn: the last message,
 * when it is still somebody's question. Anything else — the agent has answered, or the
 * job belongs to a render — is not a turn about a shot, and nothing should be drawn
 * around one.
 */
export function workingOn(messages: Message[], working: boolean): string[] {
  if (!working) return [];
  const last = messages[messages.length - 1];
  if (!last || last.role !== "user") return [];
  return last.context?.selection ?? [];
}

/**
 * Where a turn about one shot stands, in the words the popover shows.
 *
 * `blocked` is deliberately its own state and not a disabled button: the project runs one
 * job at a time, so asking about a second shot while the first is being worked on is not
 * a mistake to be greyed out, it is a wait to be explained — and, where the conversation
 * can hold a queue, a wait somebody can leave their question in rather than sit through.
 */
export type AskState =
  | { kind: "idle" }
  | { kind: "working"; since: number }
  | { kind: "answered"; messageId: number; text: string; operations: number; undone: boolean }
  | { kind: "blocked"; reason: string; queueable: boolean };

export function askState(
  messages: Message[],
  itemId: string,
  chat: { working: boolean; lockedReason?: string; canQueue?: boolean },
): AskState {
  const turn = turnAbout(messages, itemId);
  const mine = workingOn(messages, chat.working).includes(itemId);
  if (mine && turn) return { kind: "working", since: turn.asked.at };
  if (chat.working) return { kind: "blocked", reason: chat.lockedReason ?? "a run is in progress", queueable: chat.canQueue ?? false };
  if (turn?.answer) {
    const changes = turn.answer.changes;
    return {
      kind: "answered",
      messageId: turn.answer.id,
      text: turn.answer.text,
      operations: changes?.operations ?? 0,
      undone: changes?.undone ?? false,
    };
  }
  return { kind: "idle" };
}
