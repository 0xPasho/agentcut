"use client";
import { useEffect, useState } from "react";
import { api, type MessageContext } from "@/lib/client";
import { useProjectChat } from "@/lib/use-chat";
import { Chat } from "./chat";
import { OnboardingChat } from "./onboarding-chat";

/**
 * The project's agent, as a chat.
 *
 * Everything here is the shared chat: the thread, the steps each run took, dropped
 * files, the harness picker. What this adds is the project — the editor's context
 * travels with every message, and the quick actions are this project's.
 */

/**
 * Quick actions are preset messages with a scope, nothing more: the same run as
 * typing them. Deterministic work (silence removal, template apply) has its own
 * buttons and never goes through here.
 */
const QUICK_ACTIONS: Array<{ label: string; text: (selected: string | null) => string }> = [
  { label: "Suggest b-roll", text: (s) => `Suggest b-roll for ${s ? `"${s}"` : "this video"}: where a picture or a frame from the footage would help, and place the best ones with the template's image settings.` },
  { label: "Improve the hook", text: (s) => `Improve the hook of ${s ? `"${s}"` : "this video"}: tighten the first three seconds, propose a sharper title if the captions do not already say it, and keep the speaker's words.` },
  { label: "Reframe", text: (s) => `Check the framing of ${s ? `"${s}"` : "this video"} against the frames: keep the speaker centred, use a split when the frame is a screen share with a webcam, and fix crop keyframes where a face is cut off.` },
  { label: "Clean rhythm", text: (s) => `Clean the rhythm of ${s ? `"${s}"` : "this video"}: cut dead air over half a second except pauses doing rhetorical work, and add two to four punch-ins on the lines that land.` },
];

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
