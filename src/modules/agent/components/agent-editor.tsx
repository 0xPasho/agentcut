"use client";
import { useEffect, useState } from "react";
import { api } from "@/common/api/client";
import type { ChatController } from "@/modules/agent/types";
import { Chat } from "./chat";
import { OnboardingChat } from "../../onboarding/components/onboarding-chat";
import { QUICK_ACTIONS } from "../data";

/**
 * The project's conversation, opened once by whoever shows it.
 *
 * A project has one conversation and one job at a time. Two controllers over it would be
 * two pollers, two elapsed clocks and two accounts of what is running, so the screen owns
 * it — the editor needs it in a second place, to draw what the agent is working on around
 * the clip it is working on.
 */
export function AgentEditor({ projectId, prefill, selection, controller }: {
  projectId: string;
  /** Text to start the next message with, e.g. from "Ask the agent about this". A new nonce applies it again. */
  prefill?: { text: string; nonce: number } | null;
  /** The selected clip, for quick actions to name. */
  selection?: { id: string; title: string } | null;
  controller: ChatController;
}) {
  const [packActions, setPackActions] = useState<Array<{ label: string; text: string; pack: string }>>([]);
  useEffect(() => { api.editorTool<Array<{ label: string; text: string; pack: string }>>(projectId, { tool: "quickactions.list" }).then(setPackActions).catch(() => setPackActions([])); }, [projectId]);

  const named = selection?.title ?? null;
  const suggestions = [
    ...QUICK_ACTIONS.map((a) => ({ label: a.label, text: a.text(named) })),
    ...packActions.map((a) => ({ label: a.label, title: `From pack ${a.pack}`, text: a.text.replaceAll("{selection}", named ? `"${named}"` : "this video") })),
  ];

  return <Chat
    controller={controller}
    prefill={prefill}
    suggestions={suggestions}
    /* The interview, asked in conversation. It renders nothing once it is done,
       skipped, or the owner has preferences already, and never blocks the composer. */
    header={<OnboardingChat />}
  />;
}
