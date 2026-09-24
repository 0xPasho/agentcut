"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { type ChatController } from "@/modules/agent/types";
import { AgentThread } from "./agent-thread";
import { PromptComposer } from "./prompt-composer";
import { type PromptComposerHandle } from "../types";

/**
 * The chat, wherever it is.
 *
 * A thread of turns with the run's own steps inside them, and a composer that takes
 * text, dropped files and a pasted screenshot. It knows nothing about projects: the
 * controller decides where the turns come from and what sending one does, so the
 * panel in the editor and the empty window that starts a project are this same
 * component with a different controller.
 */
export function Chat({ controller, prefill, header, suggestions, tools, below, threadClassName, composerLabel, autoFocus, threadHidden }: {
  controller: ChatController;
  /** Text to start the next message with, e.g. from "Ask the agent about this". A new nonce applies it again. */
  prefill?: { text: string; nonce: number } | null;
  /** Anything that belongs above the first turn, e.g. the setup interview. */
  header?: ReactNode;
  /** Chips offered while the box is empty, the way a chat offers openers. */
  suggestions?: Array<{ label: string; text: string; title?: string }>;
  /** Controls on the composer's own row: a template picker, a shape. */
  tools?: ReactNode;
  /** Anything under the composer — the gallery of shapes on the home screen. */
  below?: ReactNode;
  threadClassName?: string;
  composerLabel?: string;
  autoFocus?: boolean;
  /** An empty window has nothing to show yet: the composer is the whole screen. */
  threadHidden?: boolean;
}) {
  const [instruction, setInstruction] = useState("");
  const input = useRef<PromptComposerHandle>(null);
  useEffect(() => {
    if (!prefill) return;
    setInstruction(prefill.text);
    input.current?.focus();
  }, [prefill]);
  useEffect(() => { if (autoFocus) input.current?.focus(); }, [autoFocus]);

  const send = async () => {
    const text = instruction.trim();
    // An attachment with no words is still a message: "here, look at this".
    if (!text && !controller.attachments.length) return;
    setInstruction("");
    try { await controller.send(text); }
    catch { setInstruction(text); }
  };

  const busy = controller.working;
  // Where a conversation continues, a message written mid-run waits its turn instead
  // of being refused; the controller says whether it has somewhere to wait.
  const canQueue = !!controller.queued;
  return (
    <div className="flex min-h-0 flex-col gap-2">
      {threadHidden ? null : <AgentThread
        messages={controller.messages}
        events={controller.events}
        working={busy}
        workingLabel={controller.workingLabel}
        stage={controller.stage}
        elapsed={controller.elapsed}
        progress={controller.progress}
        onStop={controller.stop}
        canStop={controller.canStop}
        onUndo={controller.undo}
        busy={busy}
        interrupted={controller.interrupted}
        queued={controller.queued ?? []}
        {...(controller.cancelQueued ? { onCancelQueued: controller.cancelQueued } : {})}
        header={header}
        {...(threadClassName ? { className: threadClassName } : {})}
      />}
      <PromptComposer
        ref={input}
        projectId={controller.projectId}
        value={instruction}
        onChange={setInstruction}
        onSend={send}
        busy={busy}
        canQueue={canQueue}
        {...(controller.stop && controller.canStop ? { onStop: controller.stop } : {})}
        label={composerLabel}
        placeholder={controller.placeholder}
        lockedReason={controller.lockedReason}
        attachments={controller.attachments}
        onFiles={controller.attach}
        onRemoveAttachment={controller.removeAttachment}
        attaching={controller.attaching}
        actions={!instruction.trim() && !busy && suggestions?.length ? <>
          {suggestions.map((s) => (
            <button
              key={s.label}
              type="button"
              title={s.title}
              onClick={() => { setInstruction(s.text); input.current?.focus(); }}
              className="rounded-full border border-border bg-card/40 px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              {s.label}
            </button>
          ))}
        </> : null}
        tools={tools}
        footer={<>
          {controller.error ? <p role="alert" className="text-xs text-destructive">{controller.error}</p> : null}
          {below}
        </>}
      />
    </div>
  );
}
