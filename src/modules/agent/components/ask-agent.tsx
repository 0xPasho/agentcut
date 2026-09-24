"use client";

import { useEffect, useRef, useState } from "react";
import { ListPlus, Loader2, Send, Sparkles, Square, Undo2 } from "lucide-react";
import { Button } from "@/common/ui/button";
import { Textarea } from "@/common/ui/textarea";
import { askState } from "@/modules/agent/lib/ask-agent";
import type { ChatController } from "@/modules/agent/types";
import { Markdown } from "./markdown";
import { QUICK_ACTIONS } from "../data";

/**
 * Asking the agent about one shot, next to that shot.
 *
 * "Ask the agent about this" used to write a sentence into the panel across the screen
 * and leave: whatever you then typed went to the same place every other message goes,
 * and nothing on the timeline said which clip the answer had been about. The question is
 * asked here, beside the thing it is about, and what happens next is drawn around that
 * thing while it happens.
 *
 * It is not a second chat. The controller is the project's one conversation — the same
 * thread the panel shows, the same one a terminal agent writes to over MCP — so a
 * question asked here is in the history, and the panel is already showing it.
 */
export function AskAgent({ controller, itemId, title, onClose }: {
  controller: ChatController;
  itemId: string;
  /** What the shot is called, so the question has a subject and the reader has a heading. */
  title: string;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState("");
  const field = useRef<HTMLTextAreaElement>(null);
  const state = askState(controller.messages, itemId, { ...controller, canQueue: !!controller.queued });
  const queueing = state.kind === "blocked";
  // The state to return to once a turn lands: a popover that keeps saying "working" after
  // the answer has arrived is the same lie as one that never said anything.
  useEffect(() => { if (state.kind === "idle") field.current?.focus(); }, [state.kind]);

  const ask = (text: string) => {
    const message = text.trim();
    if (!message) return;
    setDraft("");
    void controller.send(message);
  };

  return (
    <div className="flex w-80 flex-col gap-3" role="group" aria-label={`Ask the agent about ${title}`}>
      <p className="truncate text-xs font-medium" title={title}>{title}</p>

      {/* One region for every answer this can give, so a screen reader hears the change
          without the popover having to move focus while somebody is reading it. */}
      <div aria-live="polite" className="contents">
        {state.kind === "working" ? (
          <div className="flex flex-col gap-2">
            <p className="flex items-center gap-2 text-sm">
              <Loader2 aria-hidden className="size-4 shrink-0 motion-safe:animate-spin" />
              {controller.stage || controller.workingLabel || "Working on this"}
              <span className="ms-auto tabular-nums text-xs text-muted-foreground">{controller.elapsed}s</span>
            </p>
            <p className="text-[11px] text-muted-foreground">It is marked on the timeline while it runs. You can close this and keep editing elsewhere.</p>
            {controller.canStop && controller.stop
              ? <Button size="xs" variant="outline" onClick={controller.stop}><Square />Stop</Button>
              : null}
          </div>
        ) : null}

        {state.kind === "blocked" ? (
          <p className="text-sm text-muted-foreground">
            {state.reason} — this project runs one thing at a time.
            {state.queueable ? " Ask anyway and it goes as soon as that ends." : ""}
          </p>
        ) : null}

        {state.kind === "answered" ? (
          <div className="flex flex-col gap-2">
            <Markdown text={state.text} className="max-h-40 overflow-y-auto text-sm" />
            {state.operations > 0 ? (
              <p className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <span>{state.operations} change{state.operations === 1 ? "" : "s"} saved{state.undone ? ", undone" : ""}</span>
                {!state.undone && controller.undo
                  ? <Button size="xs" variant="ghost" onClick={() => controller.undo?.(state.messageId)}><Undo2 />Undo this turn</Button>
                  : null}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      {state.kind === "idle" || state.kind === "answered" || (state.kind === "blocked" && state.queueable) ? (
        <>
          <Textarea
            ref={field}
            rows={3}
            aria-label={`Ask the agent about ${title}`}
            placeholder={state.kind === "answered" ? "Ask for something else…" : `What should change about “${title}”?`}
            aria-describedby={queueing ? "ask-queue-hint" : undefined}
            value={draft}
            onChange={event => setDraft(event.target.value)}
            // Enter sends, because this is one question rather than a document; a line
            // break is still a line break with Shift held.
            onKeyDown={event => {
              if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); ask(draft); }
              if (event.key === "Escape") onClose();
            }}
          />
          <div className="flex flex-wrap gap-1.5">
            {QUICK_ACTIONS.map(action => (
              <Button key={action.label} size="xs" variant="outline" onClick={() => ask(action.text(title))}>
                <Sparkles />{action.label}
              </Button>
            ))}
          </div>
          <Button size="sm" disabled={!draft.trim()} onClick={() => ask(draft)}>
            {queueing ? <><ListPlus />Queue it</> : <><Send />Ask</>}
          </Button>
          {queueing && controller.queued?.length ? (
            <p id="ask-queue-hint" className="text-[11px] text-muted-foreground">
              {controller.queued.length} message{controller.queued.length === 1 ? "" : "s"} already waiting, in the panel.
            </p>
          ) : null}
        </>
      ) : null}

      {controller.error ? <p role="alert" className="text-xs text-destructive">{controller.error}</p> : null}
    </div>
  );
}
