"use client";
import { useCallback, useEffect, useState } from "react";
import { Check, Loader2, MessageSquareOff } from "lucide-react";
import { api } from "@/lib/client";
import type { CommentChoices } from "@/lib/chat/place";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

const PLATFORMS: Record<string, string> = { tiktok: "TikTok", twitch: "Twitch", youtube: "YouTube", kick: "Kick" };

/**
 * The viewer comment a stream video opens on. The list is the chat around the clip,
 * ranked by how much of each message the streamer reads out — the same ranking the
 * template uses to choose one on its own — and choosing here writes the same layer.
 * Every button is a project tool an agent can call: `comments.list`, `comments.place`,
 * `chat.source`, `chat.setSource`.
 */
export function CommentPanel({ projectId, sequenceId, beforeApply, afterApply }: {
  projectId: string;
  sequenceId: string;
  beforeApply: () => Promise<boolean>;
  afterApply: () => Promise<void>;
}) {
  const [choices, setChoices] = useState<CommentChoices | null>(null);
  const [path, setPath] = useState("");
  const [pending, setPending] = useState<string | number | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const listed = await api.editorTool<CommentChoices>(projectId, { tool: "comments.list", sequenceId });
      setChoices(listed);
      setPath(listed.source ?? "");
    } catch (reason) { setError((reason as Error).message); }
  }, [projectId, sequenceId]);
  useEffect(() => { void load(); }, [load]);

  const place = async (commentId: number | "none") => {
    setPending(commentId);
    setError("");
    try {
      if (!(await beforeApply())) return;
      const current = await api.getProject(projectId);
      await api.editorTool(projectId, { tool: "comments.place", sequenceId, commentId, expectedRevision: current.revision });
      await afterApply();
      await load();
    } catch (reason) { setError((reason as Error).message); }
    finally { setPending(null); }
  };

  const saveSource = async () => {
    setPending("source");
    setError("");
    try { await api.editorTool(projectId, { tool: "chat.setSource", path }); await load(); }
    catch (reason) { setError((reason as Error).message); }
    finally { setPending(null); }
  };

  if (!choices && !error) return <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 motion-safe:animate-spin" />Reading the chat…</p>;

  const openedOn = choices?.current;
  return (
    <div className="flex flex-col gap-4 text-sm">
      <p className="text-muted-foreground">
        The comment the video opens on, before the hook. Messages the clip reads out are marked; choosing one draws it as the chat showed it.
      </p>

      {choices?.problem && <p className="rounded-2xl border border-white/8 bg-white/5 px-3 py-2 text-muted-foreground">{choices.problem}</p>}
      {error && <p role="alert" className="rounded-2xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive">{error}</p>}

      {openedOn && (
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/8 bg-white/5 px-3 py-2">
          <span>Opens on a comment for {openedOn.seconds.toFixed(1)}s.</span>
          <Button variant="ghost" size="sm" disabled={pending !== null} onClick={() => void place("none")}>
            {pending === "none" ? <Loader2 className="motion-safe:animate-spin" /> : <MessageSquareOff />}Remove
          </Button>
        </div>
      )}

      {!!choices?.comments.length && (
        <ul className="flex flex-col gap-2" aria-label="Chat around this clip">
          {choices.comments.map((comment) => (
            <li key={comment.id} className="flex items-start gap-3 rounded-2xl border border-white/8 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{comment.name}</span>
                  <span>{PLATFORMS[comment.platform] ?? comment.platform}</span>
                  <span className="tabular-nums">{comment.offsetSec <= 0 ? `${Math.abs(comment.offsetSec).toFixed(0)}s before` : `${comment.offsetSec.toFixed(0)}s in`}</span>
                  {comment.answers && <Badge variant="secondary">Read out</Badge>}
                </p>
                <p className="mt-1 break-words">{comment.text}</p>
              </div>
              <Button variant="outline" size="sm" disabled={pending !== null} onClick={() => void place(comment.id)}>
                {pending === comment.id ? <Loader2 className="motion-safe:animate-spin" /> : <Check />}Use
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-2">
        <Label htmlFor="chat-source">Chat database</Label>
        <div className="flex gap-2">
          <Input id="chat-source" value={path} placeholder="~/restream-tiktok-chat/data/chat.db" onChange={(event) => setPath(event.target.value)} />
          <Button variant="outline" disabled={pending !== null || path === (choices?.source ?? "")} onClick={() => void saveSource()}>
            {pending === "source" && <Loader2 className="motion-safe:animate-spin" />}Save
          </Button>
        </div>
      </div>
    </div>
  );
}
