"use client";
import Link from "next/link";
import { Clapperboard } from "lucide-react";
import { useStartChat } from "@/lib/use-chat";
import { Chat } from "./chat";
import { Button } from "./ui/button";
import { Glass } from "./ui/glass";

/**
 * A project does not have to start from footage.
 *
 * Say what you want and this makes the project and hands the sentence to the agent;
 * drop a video and it starts from that; paste a link and it clips it. All three land
 * in the same editor with the conversation already open, because the first thing
 * somebody says is the most useful thing they will ever say about a video.
 */
const SUGGESTIONS = [
  { label: "Explain something", text: "Make a 30-second explainer about " },
  { label: "From a link", text: "Find the best clips in https://" },
  { label: "A title card", text: "Start me a 9:16 video with a bold title card that says " },
];

/**
 * The conversation itself, without a page around it. The home screen mounts this as one
 * of its three ways in; `/chat` is the same panel on a page of its own.
 */
export function StartChatPanel({ heading = "What are we making?" }: { heading?: string }) {
  const controller = useStartChat();
  return (
    <div className="flex flex-1 flex-col justify-end gap-4">
        {!controller.messages.length ? (
          <div className="space-y-2 pt-10 text-center">
            <h2 className="text-balance text-3xl font-semibold tracking-tight">{heading}</h2>
            <p className="text-pretty text-sm leading-relaxed text-muted-foreground">
              Describe it, drop a video or an image, or paste a link. Everything lands in the editor with this conversation already going.
            </p>
          </div>
        ) : null}
        <Chat
          controller={controller}
          suggestions={SUGGESTIONS}
          autoFocus
          threadHidden={!controller.messages.length}
          threadClassName="h-[24rem]"
        />
    </div>
  );
}

export function StartChat() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-6 px-4 pt-4 pb-10 sm:px-6">
      <Glass shape="capsule" thickness="thick" className="sticky top-4 z-20 flex items-center gap-2 px-3 py-3 sm:gap-3 sm:px-5">
        <Clapperboard className="size-6 shrink-0 text-primary" />
        <h1 className="text-xl font-semibold tracking-tight">agentcut</h1>
        <Button variant="ghost" size="sm" nativeButton={false} className="ml-auto" render={<Link href="/" />}>Projects</Button>
      </Glass>
      <StartChatPanel />
    </main>
  );
}
