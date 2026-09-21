"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, SendHorizontal } from "lucide-react";
import { api, type Message, type MessageContext } from "@/lib/client";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";
import { ScrollArea } from "./ui/scroll-area";

/**
 * The project's conversation. Every interface writes to the same thread — this
 * panel, the CLI, a terminal agent over MCP — so what shows here is everything
 * that has been said to and by the agent about this project.
 */
const SOURCE_LABELS: Record<string, string> = { web: "you", cli: "you (cli)", mcp: "terminal agent", agent: "agent", brief: "brief" };

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
  const [instruction, setInstruction] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [pending, setPending] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState("");
  const bottom = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const [packActions, setPackActions] = useState<Array<{ label: string; text: string; pack: string }>>([]);
  useEffect(() => { api.editorTool<Array<{ label: string; text: string; pack: string }>>(projectId, { tool: "quickactions.list" }).then(setPackActions).catch(() => setPackActions([])); }, [projectId]);
  useEffect(() => {
    if (!prefill) return;
    setInstruction(prefill.text);
    input.current?.focus();
  }, [prefill]);

  const load = useCallback(async () => {
    try {
      const { messages } = await api.messages(projectId);
      setMessages(messages);
      // The agent's reply is the last turn; until it lands the thread is still open.
      setWaiting(messages.length > 0 && messages[messages.length - 1].role === "user" && messages[messages.length - 1].source !== "brief");
    } catch { /* transient */ }
  }, [projectId]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(load, 2000);
    return () => clearInterval(timer);
  }, [waiting, load]);
  useEffect(() => { bottom.current?.scrollIntoView({ block: "end" }); }, [messages.length]);

  const send = async () => {
    const text = instruction.trim();
    if (!text) return;
    setPending(true); setError("");
    try {
      if (!(await beforeRun())) return;
      const current = await api.getProject(projectId);
      await api.agentEdit(projectId, text, current.revision, context?.());
      setInstruction("");
      setWaiting(true);
      await load();
    } catch (e) { setError((e as Error).message); }
    finally { setPending(false); }
  };

  return <div className="space-y-3">
    {messages.length > 0 && <ScrollArea className="h-56 rounded-xl border border-border">
      <ol className="space-y-2 p-3 text-sm">
        {messages.map((m) => <li key={m.id} className={m.role === "user" ? "" : "text-muted-foreground"}>
          <span className="mr-1 rounded bg-muted px-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">{SOURCE_LABELS[m.source] ?? m.source}</span>
          <span className="whitespace-pre-wrap break-words">{m.text}</span>
          {m.changes && m.changes.operations > 0 && <span className="ml-2 inline-flex items-center gap-1 text-[11px]">
            <span>{m.changes.operations} change{m.changes.operations === 1 ? "" : "s"}{m.changes.undone ? ", undone" : ""}</span>
            {!m.changes.undone && <Button size="xs" variant="ghost" disabled={pending || waiting} onClick={async () => {
              setError("");
              try { if (!(await beforeRun())) return; await api.undoMessage(projectId, m.id); await afterUndo?.(); await load(); }
              catch (e) { setError((e as Error).message); }
            }}>Undo</Button>}
          </span>}
        </li>)}
        {waiting && <li className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-3 motion-safe:animate-spin" />The agent is working. Saved changes appear on the timeline as they land.</li>}
        <div ref={bottom} />
      </ol>
    </ScrollArea>}
    <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); void send(); }}>
      <label className="flex flex-col gap-2 text-sm font-medium">{messages.length ? "Continue" : "Tell the agent what you want"}
        <Textarea ref={input} required value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder={messages.length ? "Shorter hook, and lower the music." : "Move the title to the bottom and lower the music volume."}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send(); } }} />
      </label>
      <div className="flex flex-wrap gap-1.5" aria-label="Quick actions">
        {QUICK_ACTIONS.map((action) => <Button key={action.label} type="button" size="xs" variant="ghost" disabled={pending || waiting} onClick={() => { setInstruction(action.text(selection?.title ?? null)); input.current?.focus(); }}>{action.label}</Button>)}
        {packActions.map((action) => <Button key={`${action.pack}:${action.label}`} type="button" size="xs" variant="ghost" title={`From pack ${action.pack}`} disabled={pending || waiting} onClick={() => { setInstruction(action.text.replaceAll("{selection}", selection ? `"${selection.title}"` : "this video")); input.current?.focus(); }}>{action.label}</Button>)}
      </div>
      <div className="flex items-center gap-2">
        <Button variant="outline" type="submit" disabled={pending || waiting}>{pending ? <Loader2 className="motion-safe:animate-spin" /> : <SendHorizontal />}{waiting ? "Working…" : "Send"}</Button>
        <span className="text-xs text-muted-foreground">⌘↩ to send</span>
      </div>
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </form>
  </div>;
}
