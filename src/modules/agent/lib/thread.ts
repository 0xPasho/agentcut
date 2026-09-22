import type { LogEvent, Message } from "../../../common/api/client";

/**
 * The conversation and the activity feed, read as one thread.
 *
 * They are separate tables written by separate processes — a message when somebody
 * speaks, an event when a run takes a step — and the clock is the only thing that
 * relates them. It is enough: a turn is what was asked, the steps that answered it,
 * and the reply, in the order they happened.
 */
export type ThreadItem =
  | { kind: "message"; at: number; message: Message }
  | { kind: "steps"; at: number; id: string; events: LogEvent[] };

/** Two lines this far apart are not one run, whatever the table says. */
export const GAP_MS = 3 * 60_000;

export function buildThread(messages: Message[], events: LogEvent[]): ThreadItem[] {
  const merged = [
    ...messages.map((message) => ({ at: message.at, message, order: 0 })),
    ...events.map((event) => ({ at: event.at, event, order: 1 })),
  ].sort((a, b) => a.at - b.at || a.order - b.order);

  const items: ThreadItem[] = [];
  for (const entry of merged) {
    if ("message" in entry) { items.push({ kind: "message", at: entry.at, message: entry.message }); continue; }
    const last = items[items.length - 1];
    // Same run, or close enough in time to be one. Otherwise yesterday's analysis and
    // this morning's edit collapse into a single group lasting nineteen hours.
    if (last?.kind === "steps") {
      const previous = last.events[last.events.length - 1];
      const sameRun = (previous.jobId ?? null) === (entry.event.jobId ?? null) && entry.at - previous.at < GAP_MS;
      if (sameRun) { last.events.push(entry.event); continue; }
    }
    items.push({ kind: "steps", at: entry.at, id: `steps-${entry.event.id}`, events: [entry.event] });
  }
  return items;
}
