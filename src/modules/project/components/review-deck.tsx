"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import {
  BadgeCheck,
  CircleX,
  Clapperboard,
  Loader2,
  Maximize2,
  MessageSquare,
  Minimize2,
  SkipForward,
  SlidersHorizontal,
  Undo2,
  X,
} from "lucide-react";
import { cn } from "cn";
import { Button, buttonVariants } from "@/common/ui/button";
import { count, runtime } from "@/common/lib/format";
import { thumbUrl } from "@/common/api/client";
import { VideoPreview } from "@/modules/editor/components/video-preview";
import { EditorStatus } from "@/modules/editor/components/editor-status";
import type { useEditor } from "@/modules/editor/hooks/use-editor";
import type { Edl } from "@/modules/editor/types";
import { AgentEditor } from "@/modules/agent/components/agent-editor";
import type { ChatController } from "@/modules/agent/types";
import type { ProjectVideo } from "../lib/overview";
import { reviewTally } from "../lib/review";
import { useSwipe } from "../hooks/use-swipe";
import { STATUS, SWIPE, VERDICTS } from "../data";
import type { ReviewStep, Verdict } from "../types";
import { StatusIcon } from "./clip-list";

/**
 * Triage, one video at a time: throw it right to keep it, left to drop it.
 *
 * A verdict is a status, set through the same operations the list's approve button and
 * the agent use, so nothing decided here is a separate record — and "drop" is the
 * `rejected` status, never a delete, because a swipe is too quick a gesture to lose work
 * to. The project's one conversation sits beside the card, already pointed at it, for
 * the video that is nearly right: say what is wrong, watch it change, then decide.
 */
export function ReviewDeck({
  open,
  onOpenChange,
  queue,
  videos,
  edl,
  projectId,
  revision,
  assetUrls,
  chat,
  editor,
  busy,
  onCurrent,
  onVerdict,
  onRender,
  href,
  onOpenEditor,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The ids to walk, fixed when the session opened, so a verdict does not reshuffle it. */
  queue: string[];
  /** Every video, live: the agent may change the one on screen while it is on screen. */
  videos: ProjectVideo[];
  edl: Edl;
  projectId: string;
  revision: number;
  assetUrls: Record<string, string>;
  chat: ChatController;
  editor: ReturnType<typeof useEditor>;
  busy: boolean;
  onCurrent: (id: string | null) => void;
  onVerdict: (video: ProjectVideo, status: ProjectVideo["status"]) => Promise<boolean>;
  onRender: (ids: string[]) => void;
  href: (video: ProjectVideo) => string;
  onOpenEditor: (video: ProjectVideo) => (event: React.MouseEvent) => void;
}) {
  const [index, setIndex] = useState(0);
  const [steps, setSteps] = useState<ReviewStep[]>([]);
  const [chatOpen, setChatOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [deciding, setDeciding] = useState(false);
  const popup = useRef<HTMLDivElement>(null);

  // A video the agent or another tab deleted mid-session drops out of the walk.
  const live = useMemo(() => queue.filter((id) => videos.some((video) => video.id === id)), [queue, videos]);
  const current = videos.find((video) => video.id === live[index]) ?? null;
  const next = videos.find((video) => video.id === live[index + 1]) ?? null;
  const tally = reviewTally(steps);
  const done = index >= live.length;

  useEffect(() => { onCurrent(open ? current?.id ?? null : null); }, [open, current?.id, onCurrent]);

  useEffect(() => {
    const sync = () => setFullscreen(document.fullscreenElement !== null);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  const decide = async (verdict: Verdict | null) => {
    if (!current || deciding) return;
    const step: ReviewStep = { id: current.id, previous: verdict ? current.status : null, verdict };
    if (verdict && current.status !== verdict) {
      setDeciding(true);
      const ok = await onVerdict(current, verdict).finally(() => setDeciding(false));
      if (!ok) return;
    }
    setSteps((all) => [...all, step]);
    setIndex((i) => i + 1);
  };

  const swipe = useSwipe((verdict) => { void decide(verdict); }, { disabled: !current || deciding || busy });

  const undo = async () => {
    const step = steps.at(-1);
    if (!step || deciding) return;
    const video = videos.find((candidate) => candidate.id === step.id);
    if (video && step.previous && video.status !== step.previous) {
      setDeciding(true);
      const ok = await onVerdict(video, step.previous).finally(() => setDeciding(false));
      if (!ok) return;
    }
    setSteps((all) => all.slice(0, -1));
    setIndex((i) => Math.max(0, i - 1));
  };

  const toggleFullscreen = () => {
    if (document.fullscreenElement) { void document.exitFullscreen().catch(() => {}); return; }
    void popup.current?.requestFullscreen?.().catch(() => {});
  };

  const close = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    onOpenChange(false);
  };

  // Arrows decide, as on every deck of this shape. Not while typing to the agent.
  const onKeyDown = (event: React.KeyboardEvent) => {
    const target = event.target as HTMLElement;
    if (target.closest("input, textarea, select, [contenteditable=true], [role=listbox], [role=menu]")) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const key = event.key;
    if (key === VERDICTS.approved.key || key === VERDICTS.rejected.key) {
      event.preventDefault();
      swipe.fling(key === VERDICTS.approved.key ? "approved" : "rejected");
      return;
    }
    if (key === "ArrowDown") { event.preventDefault(); void decide(null); return; }
    if (key === "z" || key === "Backspace") { event.preventDefault(); void undo(); }
  };

  const width = popup.current?.offsetWidth ?? 1000;
  const flyX = swipe.leaving === "approved" ? width : swipe.leaving === "rejected" ? -width : swipe.dx;
  const lean = Math.max(-1, Math.min(1, flyX / Math.max(SWIPE.minDistance, 260)));
  const approvedIds = videos.filter((video) => video.status === "approved").map((video) => video.id);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(value) => { if (!value) close(); }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-background" />
        <DialogPrimitive.Popup
          ref={popup}
          aria-label="Review videos"
          onKeyDown={onKeyDown}
          className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-background text-foreground outline-none lg:flex-row lg:overflow-hidden motion-safe:data-open:animate-in data-open:fade-in-0 motion-safe:data-closed:animate-out data-closed:fade-out-0"
        >
          <section className="relative flex min-h-dvh min-w-0 flex-1 flex-col lg:min-h-0">
            <header className="flex items-center gap-3 px-4 pt-4 sm:px-6">
              <DialogPrimitive.Close render={<Button variant="ghost" size="icon" aria-label="Close review" title="Close (Esc)" className="size-10 bg-foreground/5 ring-1 ring-inset ring-foreground/10" />}>
                <X aria-hidden className="size-4" />
              </DialogPrimitive.Close>
              <div className="min-w-0 flex-1">
                <DialogPrimitive.Title className="text-base font-semibold tracking-tight">Review</DialogPrimitive.Title>
                <p role="status" className="text-xs text-muted-foreground tabular-nums">
                  {done ? `All ${count(live.length, "video", "videos")} reviewed` : `${index + 1} of ${live.length}`}
                </p>
              </div>
              <div className="flex items-center gap-3 text-xs tabular-nums text-muted-foreground">
                <span className="flex items-center gap-1.5" title="Approved this session"><BadgeCheck aria-hidden className="size-4 text-primary" />{tally.approved}<span className="sr-only">approved</span></span>
                <span className="flex items-center gap-1.5" title="Rejected this session"><CircleX aria-hidden className="size-4 text-destructive" />{tally.rejected}<span className="sr-only">rejected</span></span>
              </div>
              <Button variant="ghost" size="icon" aria-label={fullscreen ? "Exit full screen" : "Full screen"} title={fullscreen ? "Exit full screen" : "Full screen"} onClick={toggleFullscreen}>
                {fullscreen ? <Minimize2 aria-hidden className="size-4" /> : <Maximize2 aria-hidden className="size-4" />}
              </Button>
              <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Agent" aria-expanded={chatOpen} onClick={() => setChatOpen((v) => !v)}>
                <MessageSquare aria-hidden className="size-4" />
              </Button>
            </header>

            <div aria-hidden className="mx-4 mt-3 h-1 overflow-hidden rounded-full bg-white/8 sm:mx-6">
              <div className="h-full rounded-full bg-white/50 transition-[width] duration-300 ease-out motion-reduce:transition-none" style={{ width: `${live.length ? (Math.min(index, live.length) / live.length) * 100 : 0}%` }} />
            </div>

            {done || !current ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
                <BadgeCheck aria-hidden className="size-10 text-primary" strokeWidth={1.5} />
                <div>
                  <h2 className="text-lg font-semibold">Nothing left to review</h2>
                  <p className="mt-1 text-sm text-muted-foreground tabular-nums">
                    {count(tally.approved, "approved", "approved")} · {count(tally.rejected, "rejected", "rejected")} this session
                  </p>
                </div>
                <div className="flex flex-wrap justify-center gap-2">
                  {steps.length > 0 && (
                    <Button variant="ghost" disabled={deciding} onClick={() => void undo()}><Undo2 aria-hidden />Undo last</Button>
                  )}
                  {approvedIds.length > 0 && (
                    <Button disabled={busy} onClick={() => onRender(approvedIds)}>
                      {busy ? <Loader2 aria-hidden className="motion-safe:animate-spin" /> : <Clapperboard aria-hidden />}
                      Render {count(approvedIds.length, "approved video", "approved videos")}
                    </Button>
                  )}
                  <Button variant="outline" onClick={close}>Back to videos</Button>
                </div>
              </div>
            ) : (
              <>
                <div className="relative flex min-h-0 flex-1 items-center justify-center px-4 py-4 sm:px-6">
                  {next && (
                    // The next card peeks from behind, so the deck reads as a deck.
                    <div aria-hidden className="pointer-events-none absolute inset-x-0 top-1/2 flex -translate-y-1/2 justify-center">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={thumbUrl(projectId, next.id, revision)}
                        alt=""
                        className="max-h-[calc(100dvh-20rem)] w-auto scale-[0.92] rounded-3xl opacity-40 blur-[2px] outline-1 -outline-offset-1 outline-white/10 transition-[scale,opacity] duration-200 ease-out motion-reduce:transition-none"
                        style={{ scale: swipe.dx || swipe.leaving ? 0.96 : undefined, opacity: swipe.dx || swipe.leaving ? 0.6 : undefined }}
                      />
                    </div>
                  )}

                  <article
                    key={current.id}
                    {...swipe.handlers}
                    aria-roledescription="card"
                    aria-label={current.title}
                    className={cn(
                      "relative z-10 flex w-full max-w-[min(100%,52rem)] touch-pan-y flex-col items-center gap-3 select-none",
                      swipe.dragging ? "cursor-grabbing" : "cursor-grab",
                      !swipe.dragging && "transition-[translate,rotate,opacity] ease-out motion-reduce:transition-none",
                    )}
                    style={{
                      translate: `${flyX}px 0`,
                      rotate: `${lean * 8}deg`,
                      opacity: swipe.leaving ? 0 : 1,
                      transitionDuration: `${SWIPE.flyMs}ms`,
                    }}
                  >
                    <div data-swipe-player className="relative w-full">
                      <VideoPreview
                        projectId={projectId}
                        video={current}
                        edl={edl}
                        assetUrls={assetUrls}
                        maxHeight="100dvh - 19rem"
                        autoPlay
                      />
                      <Stamp verdict="approved" strength={Math.max(0, lean)} />
                      <Stamp verdict="rejected" strength={Math.max(0, -lean)} />
                    </div>
                    <div className="flex w-full max-w-xl items-start gap-3 px-1">
                      {current.score !== null && (
                        <span className="flex w-9 shrink-0 flex-col items-center gap-1.5 pt-0.5">
                          <span className="text-base leading-none font-semibold tabular-nums">{current.score}</span>
                          <span aria-hidden className="h-1 w-full overflow-hidden rounded-full bg-white/12">
                            <span className="block h-full rounded-full bg-white/65" style={{ width: `${current.score}%` }} />
                          </span>
                        </span>
                      )}
                      <div className="min-w-0 flex-1">
                        <h2 className="text-base leading-snug font-medium text-balance">{current.title}</h2>
                        <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground tabular-nums">
                          <StatusIcon status={current.status} />
                          {STATUS[current.status].label} · {runtime(current.durationSec)} · {count(current.shots, "shot", "shots")}
                          {current.tags.length ? ` · ${current.tags.join(", ")}` : ""}
                        </p>
                        {current.summary ? <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground text-pretty">{current.summary}</p> : null}
                      </div>
                    </div>
                  </article>
                </div>

                <div className="flex flex-col items-center gap-3 px-4 pb-6 sm:px-6">
                  <div className="flex items-center gap-3">
                    <Button variant="ghost" size="icon" aria-label="Undo last decision" title="Undo (Z)" disabled={!steps.length || deciding} onClick={() => void undo()} className="size-11 rounded-full">
                      <Undo2 aria-hidden className="size-5" />
                    </Button>
                    <button
                      type="button"
                      aria-label={`${VERDICTS.rejected.label} ${current.title}`}
                      title="Reject (←)"
                      disabled={deciding || busy}
                      onClick={() => swipe.fling("rejected")}
                      className="flex size-16 cursor-pointer items-center justify-center rounded-full bg-destructive/12 text-destructive ring-1 ring-inset ring-destructive/40 transition-[scale,background-color] duration-150 ease-out outline-none hover:bg-destructive/22 focus-visible:ring-3 focus-visible:ring-destructive/50 active:scale-[0.96] disabled:opacity-50 motion-reduce:transition-none"
                    >
                      <X aria-hidden className="size-7" strokeWidth={2.25} />
                    </button>
                    <button
                      type="button"
                      aria-label={`${VERDICTS.approved.label} ${current.title}`}
                      title="Approve (→)"
                      disabled={deciding || busy}
                      onClick={() => swipe.fling("approved")}
                      className="flex size-16 cursor-pointer items-center justify-center rounded-full bg-primary/14 text-primary ring-1 ring-inset ring-primary/45 transition-[scale,background-color] duration-150 ease-out outline-none hover:bg-primary/24 focus-visible:ring-3 focus-visible:ring-primary/50 active:scale-[0.96] disabled:opacity-50 motion-reduce:transition-none"
                    >
                      <BadgeCheck aria-hidden className="size-7" strokeWidth={2} />
                    </button>
                    <Button variant="ghost" size="icon" aria-label="Skip for now" title="Skip (↓)" disabled={deciding} onClick={() => void decide(null)} className="size-11 rounded-full">
                      <SkipForward aria-hidden className="size-5" />
                    </Button>
                  </div>
                  {busy && <p role="status" className="text-xs text-muted-foreground">The project is busy. Decide once the agent or render finishes.</p>}
                  <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-[11px] text-muted-foreground">
                    <span className="hidden items-center gap-3 sm:flex">
                      <span><Kbd>←</Kbd> reject</span>
                      <span><Kbd>→</Kbd> approve</span>
                      <span><Kbd>↓</Kbd> skip</span>
                      <span><Kbd>Z</Kbd> undo</span>
                    </span>
                    <Link href={href(current)} onClick={onOpenEditor(current)} className={cn(buttonVariants({ variant: "ghost", size: "xs" }))}>
                      <SlidersHorizontal aria-hidden />
                      Open in editor
                    </Link>
                  </div>
                </div>
              </>
            )}
          </section>

          <aside
            aria-label="Agent"
            className={cn(
              "flex w-full shrink-0 flex-col gap-3 border-white/10 bg-white/2 p-4 lg:flex lg:h-dvh lg:w-[420px] lg:overflow-y-auto lg:border-s",
              !chatOpen && "max-lg:hidden",
            )}
          >
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
              <h2 className="text-base font-medium">Agent</h2>
              <EditorStatus editor={editor} />
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground text-pretty">
              {current ? <>Messages here are about <span className="text-foreground">{current.title}</span>. Ask for a fix, watch it update, then decide.</> : "Ask for anything across the project."}
            </p>
            <AgentEditor
              projectId={projectId}
              controller={chat}
              selection={current ? { id: current.id, title: current.title } : null}
            />
          </aside>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** The word that appears as a card leans, so the throw says what it will do before it does it. */
function Stamp({ verdict, strength }: { verdict: Verdict; strength: number }) {
  if (strength <= 0) return null;
  const approve = verdict === "approved";
  return (
    <span
      aria-hidden
      className={cn(
        "pointer-events-none absolute top-6 flex items-center gap-2 rounded-2xl border-[3px] bg-black/55 px-4 py-2 text-2xl font-bold tracking-wide uppercase backdrop-blur-sm",
        approve ? "start-6 -rotate-12 border-primary text-primary" : "end-6 rotate-12 border-destructive text-destructive",
      )}
      style={{ opacity: Math.min(1, strength * 1.4) }}
    >
      {approve ? <BadgeCheck aria-hidden className="size-6" strokeWidth={2.5} /> : <X aria-hidden className="size-6" strokeWidth={2.5} />}
      {VERDICTS[verdict].label}
    </span>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="me-1 inline-flex min-w-5 items-center justify-center rounded-md bg-white/8 px-1.5 py-0.5 font-sans text-[11px] text-foreground ring-1 ring-inset ring-white/10">{children}</kbd>;
}
