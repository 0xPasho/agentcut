"use client";
import { useEffect, useState } from "react";
import { api, type MessageContext } from "@/common/api/client";
import { useProjectChat } from "@/modules/agent/hooks/use-chat";
import { Chat } from "./chat";
import { OnboardingChat } from "../../onboarding/components/onboarding-chat";
import { QUICK_ACTIONS } from "../data";

export function AgentEditor({ projectId, beforeRun, afterUndo, context, prefill, selection }: {
  projectId: string;
  beforeRun: () => Promise<boolean>;
  /** Reload the editor after a message's changes were taken back. */
  afterUndo?: () => Promise<void>;
  /** What the editor is showing right now; sent with each message. */
  context?: () => MessageContext;
  /** Text to start the next message with, e.g. from "Ask the agent about this". A new nonce applies it again. */
  prefill?: { text: string; nonce: number } | null;
  /** The selected clip, for quick actions to name. */
  selection?: { id: string; title: string } | null;
}) {
  const controller = useProjectChat(projectId, { beforeRun, afterUndo, context });
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
