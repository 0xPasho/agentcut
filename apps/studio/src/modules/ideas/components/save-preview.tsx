"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, CircleAlert, Copy, ExternalLink, Lightbulb, Loader2, RotateCcw, Sparkles, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/common/ui/button";
import { Textarea } from "@/common/ui/textarea";
import { useSavePreview } from "../hooks";
import { clockOf, deepLink, hostOf, saveFileUrl, saveLabel } from "@agentcut/core/modules/ideas/lib";
import type { Save } from "@agentcut/core/modules/ideas/types";

/**
 * One save, seen whole: its video from the second it was kept (or its screenshot), what
 * the post said, the note, and what to do with it next. The same body sits beside the
 * library and inside an idea on the board.
 */
export function SavePreview({ save, onClose, onPrev, onNext, onChanged, onBuildIdea }: {
  save: Save;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  onChanged: () => void;
  onBuildIdea?: () => void;
}) {
  const preview = useSavePreview(save, onChanged);
  const video = useRef<HTMLVideoElement>(null);
  const [note, setNote] = useState(save.note ?? "");
  const [joinId, setJoinId] = useState("");
  useEffect(() => { setNote(save.note ?? ""); setJoinId(""); }, [save.id, save.note]);

  const hasVideo = save.mediaStatus === "done" && !!save.mediaFile;
  const seek = (sec: number) => { if (video.current) { video.current.currentTime = sec; void video.current.play().catch(() => {}); } };
  const metrics = Object.entries(save.metrics ?? {});
  const joinable = preview.ideas.filter((i) => !save.ideaIds.includes(i.id));

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-1 border-b border-border px-4 py-3">
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium">{saveLabel(save)}</span>
          <span className="truncate text-xs text-muted-foreground">
            {save.site || hostOf(save.url)} · {new Date(save.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
          </span>
        </div>
        {onPrev && <Button variant="ghost" size="icon-sm" aria-label="Previous save" title="Previous (←)" onClick={onPrev}><ChevronLeft /></Button>}
        {onNext && <Button variant="ghost" size="icon-sm" aria-label="Next save" title="Next (→)" onClick={onNext}><ChevronRight /></Button>}
        <Button variant="ghost" size="icon-sm" aria-label="Close preview" title="Close (Esc)" onClick={onClose}><X /></Button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        {/* shrink-0: in this scrolling column a long transcript would otherwise squash the video to nothing. */}
        <div className="shrink-0 overflow-hidden rounded-2xl bg-black outline outline-1 -outline-offset-1 outline-white/10">
          {hasVideo ? (
            <video
              key={save.id}
              ref={video}
              src={saveFileUrl(save.id, save.mediaFile!)}
              poster={save.screenshot ? saveFileUrl(save.id, save.screenshot) : undefined}
              controls
              autoPlay
              playsInline
              preload="metadata"
              onLoadedMetadata={(e) => { if (save.atSec) e.currentTarget.currentTime = save.atSec; }}
              className="mx-auto max-h-[55dvh] w-full object-contain"
            />
          ) : save.screenshot ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={saveFileUrl(save.id, save.screenshot)} alt={`Screenshot of ${saveLabel(save)}`} className="mx-auto max-h-[55dvh] w-full object-contain" />
          ) : (
            <div className="grid aspect-video place-items-center px-6 text-center text-sm text-muted-foreground">{save.title || save.url}</div>
          )}
        </div>

        {hasVideo && (
          <div className="-mt-1 flex flex-wrap gap-1.5">
            {!!save.atSec && <Button size="xs" variant="secondary" onClick={() => seek(save.atSec!)}>From the saved moment · {clockOf(save.atSec)}</Button>}
            <Button size="xs" variant="ghost" onClick={() => seek(0)}><RotateCcw />From the start</Button>
          </div>
        )}
        {save.mediaStatus === "pending" && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />Keeping a copy of the video…</p>
        )}
        {save.mediaStatus === "failed" && (
          <div className="flex items-start gap-2 rounded-xl border border-border bg-white/[0.03] p-3 text-xs">
            <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <span className="text-muted-foreground">The video could not be kept, so this shows the screenshot. {save.mediaError?.split("\n")[0]}</span>
              <Button size="xs" variant="outline" className="self-start" onClick={() => void preview.retryDownload()}><RotateCcw />Try the download again</Button>
            </div>
          </div>
        )}

        <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
          Your note
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onBlur={() => { if (note !== (save.note ?? "")) void preview.setNote(note); }}
            rows={3}
            placeholder="What you want to do with this: “the same, but for sardines”"
            className="text-sm text-foreground"
          />
        </label>

        {(save.text || save.title) && (
          <section aria-label="What the post said" className="flex flex-col gap-1.5">
            <h3 className="text-xs font-medium text-muted-foreground">From the post</h3>
            {save.title && save.title !== save.text && <p className="text-sm font-medium text-pretty">{save.title}</p>}
            {save.text && <p className="max-h-48 overflow-y-auto text-sm whitespace-pre-wrap text-foreground/90">{save.text}</p>}
          </section>
        )}

        {metrics.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {metrics.map(([k, v]) => (
              <span key={k} className="rounded-full border border-border bg-white/[0.04] px-2.5 py-1 text-xs tabular-nums"><span className="font-medium">{v}</span> <span className="text-muted-foreground">{k}</span></span>
            ))}
          </div>
        )}

        {hasVideo && (
          <section aria-label="Transcript" className="flex flex-col gap-1.5">
            <h3 className="text-xs font-medium text-muted-foreground">What is said</h3>
            {preview.transcript !== null ? (
              <p className="max-h-48 overflow-y-auto text-sm whitespace-pre-wrap text-foreground/90">{preview.transcript || "No words in this video."}</p>
            ) : (
              <Button size="xs" variant="outline" className="self-start" disabled={preview.transcribing} onClick={() => void preview.transcribe()}>
                {preview.transcribing ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <Sparkles />}
                {preview.transcribing ? "Listening on this computer…" : "Transcribe"}
              </Button>
            )}
          </section>
        )}

        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="outline" nativeButton={false} render={<a href={deepLink(save)} target="_blank" rel="noreferrer noopener" />}><ExternalLink />Open the original</Button>
          <Button size="sm" variant="ghost" onClick={() => { void navigator.clipboard.writeText(deepLink(save)); toast.success("Link copied"); }}><Copy />Copy link</Button>
        </div>

        <section aria-label="Ideas" className="flex flex-col gap-2 border-t border-border pt-4">
          <h3 className="text-xs font-medium text-muted-foreground">Ideas</h3>
          {save.ideaIds.length > 0 && (
            <ul className="flex flex-wrap gap-1.5">
              {save.ideaIds.map((id) => (
                <li key={id}>
                  <Link href={`/ideas?open=${id}`} className="inline-flex items-center gap-1 rounded-full border border-border bg-white/[0.04] px-2.5 py-1 text-xs hover:bg-white/10">
                    <Lightbulb className="size-3" />{preview.ideas.find((i) => i.id === id)?.title ?? "Idea"}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-center gap-1.5">
            {onBuildIdea && <Button size="sm" onClick={onBuildIdea}><Sparkles />New idea from this</Button>}
            {joinable.length > 0 && (
              <>
                <select
                  aria-label="Add to an idea"
                  value={joinId}
                  onChange={(e) => setJoinId(e.target.value)}
                  className="h-8 max-w-48 truncate rounded-full border border-white/10 bg-white/5 px-3 text-xs"
                >
                  <option value="">Add to an idea…</option>
                  {joinable.map((i) => <option key={i.id} value={i.id}>{i.title}</option>)}
                </select>
                {joinId && <Button size="sm" variant="secondary" onClick={() => { void preview.addToIdea(joinId); setJoinId(""); }}>Add</Button>}
              </>
            )}
          </div>
        </section>
      </div>

      <footer className="border-t border-border px-4 py-3">
        <Button
          size="sm"
          variant="ghost"
          className="text-destructive"
          onClick={() => { if (confirm("Delete this save? It leaves every idea it is in.")) { void preview.remove(); onClose(); } }}
        >
          <Trash2 />Delete save
        </Button>
      </footer>
    </div>
  );
}
