"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  CalendarDays,
  Captions,
  Download,
  Film,
  Loader2,
  Video,
  Search,
  SlidersHorizontal,
  Sparkles,
  Clapperboard,
} from "lucide-react";
import { cn } from "cn";
import { Button, buttonVariants } from "@/common/ui/button";
import { ProjectStatus } from "./components/project-status";
import { ProjectActions } from "./components/project-actions";
import { ProjectPublications } from "../publishing/components/project-publications";
import { calendarHref } from "@agentcut/core/modules/publishing/lib/calendar";
import { VideoSelectionBar } from "./components/video-selection-bar";
import { VideoViewOptions } from "./components/video-view-options";
import { ReviewDeck } from "./components/review-deck";
import { reviewQueue } from "@agentcut/core/modules/project/lib/review";
import { useVideoSelection } from "./hooks/use-video-selection";
import { videoActions } from "@agentcut/core/modules/editor/lib/video-actions";
import { Card } from "@/common/ui/card";
import { Input } from "@/common/ui/input";
import { Label } from "@/common/ui/label";
import { ContextMenuItem } from "@/common/ui/context-menu";
import { Progress } from "@/common/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/common/ui/select";
import { Textarea } from "@/common/ui/textarea";
import { AgentPicker } from "@/modules/agent/components/agent-picker";
import { SourceTranscript } from "@/modules/transcription/components/source-transcript";
import { Glass } from "@/common/ui/glass";
import { ClipList, StatusIcon } from "@/modules/project/components/clip-list";
import { STATUS } from "@agentcut/core/modules/project/data";
import { VideoPreview } from "@/modules/editor/components/video-preview";
import { useEditor } from "@/modules/editor/hooks/use-editor";
import { EditorStatus } from "../editor/components/editor-status";
import { useProjectChat } from "@/modules/agent/hooks/use-chat";
import { AgentEditor } from "../agent/components/agent-editor";
import { Clip } from "@agentcut/core/modules/editor/types";
import { emptySequencePlan, type SequenceStatus } from "@agentcut/core/modules/plan/types";
import { api, assetUrl, clipUrl, type ProjectDetail } from "@agentcut/core/common/api/client";
import { useProjectStream } from "@/common/hooks/use-project-stream";
import { count, runtime } from "@agentcut/core/common/lib/format";
import { projectVideos, sortVideos, statusCounts, type ProjectVideo, type VideoSort } from "@agentcut/core/modules/project/lib/overview";
import type { Edit } from "@agentcut/core/modules/editor/types";
import { useTemplates } from "@/common/hooks/use-templates";
import { BUSY, STATUSES, FILTERS, MAKES } from "@agentcut/core/modules/project/data";
import type { MakeChoice, VideoLayout } from "@agentcut/core/modules/project/types";
import { analyzeOptions, editHref } from "@agentcut/core/modules/project/lib/project-view";

export function ProjectView({ initial }: { initial: ProjectDetail }) {
  const router = useRouter();
  const statusId = useId();
  const [project, setProject] = useState(initial);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // What to make out of the source, not just how many: the templates on this machine say
  // whether that is a pack of clips or one long video, and this is the answer to that.
  const [make, setMake] = useState<MakeChoice>({ mode: "clips", templateId: "", count: 6, minutes: 0 });
  const [brief, setBrief] = useState("");
  const [finding, setFinding] = useState(false);
  const [layout, setLayout] = useState<VideoLayout>("grid");
  const [sort, setSort] = useState<VideoSort>("score");
  const [filter, setFilter] = useState<SequenceStatus | "all">("all");
  const editor = useEditor(initial.id, initial.edl ? { edl: initial.edl, revision: initial.revision } : null);
  // The review deck's card, while it is open: a message typed beside it is about it.
  const reviewFocus = useRef<string | null>(null);
  const chat = useProjectChat(initial.id, {
    beforeRun: editor.save,
    afterUndo: editor.reload,
    context: () => (reviewFocus.current ? { sequenceId: reviewFocus.current } : {}),
  });
  const [review, setReview] = useState<{ open: boolean; queue: string[]; session: number }>({ open: false, queue: [], session: 0 });
  const [error, setError] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState(false);

  const edl = editor.snapshot?.edl ?? null;
  const revision = editor.snapshot?.revision ?? initial.revision;
  const busy = actionPending || BUSY.has(project.status) || project.job?.status === "running";

  // One list, because there is one thing here. `clip.promote` moves a generated clip
  // into `sequences` under its own id on the first edit, so rendering the two
  // collections separately is what makes an edited project report "0 clips".
  const videos = useMemo(() => (edl ? projectVideos(edl) : []), [edl]);
  const counts = useMemo(() => statusCounts(videos), [videos]);
  const shown = useMemo(
    () => sortVideos(filter === "all" ? videos : videos.filter((v) => v.status === filter), sort),
    [videos, filter, sort],
  );
  const selected = useMemo(
    () => videos.find((v) => v.id === selectedId) ?? shown[0] ?? null,
    [videos, shown, selectedId],
  );
  const selection = useVideoSelection(shown.map(video => video.id));
  const checkedVideos = shown.filter(video => selection.ids.includes(video.id));

  const assetUrls = useMemo(() => {
    const out: Record<string, string> = {};
    const add = (edits: Edit[]) => {
      for (const e of edits) {
        if ((e.type === "image" || e.type === "sfx" || e.type === "music") && e.src) {
          out[e.src] = assetUrl(initial.id, e.src);
        }
      }
    };
    for (const c of edl?.clips ?? []) add(c.edits);
    for (const s of edl?.sequences ?? []) for (const i of s.items) add(i.clip.edits);
    return out;
  }, [edl, initial.id]);

  const refresh = useCallback(async () => {
    try {
      setProject(await api.getProject(initial.id));
    } catch {
      // transient; the SSE status keeps flowing
    }
  }, [initial.id]);

  // One stream for the whole page: the chat's own progress panel reads the same
  // lines, in the same order, from the same connection.
  const { name: streamName, status, error: streamError, revision: streamRevision, job } = useProjectStream(initial.id);
  useEffect(() => { if (streamName !== null) setProject(p => p.name === streamName ? p : { ...p, name: streamName }); }, [streamName]);
  useEffect(() => {
    if (status === null) return;
    setProject((p) => (p.status === status && p.error === streamError && p.job === job ? p : { ...p, status, error: streamError, job }));
  }, [status, streamError, job]);
  // A new revision, or a run that just ended, means the videos and renders on screen
  // are stale — fetch the project itself rather than patching it from the stream.
  useEffect(() => { if (streamRevision) void refresh(); }, [streamRevision, refresh]);
  useEffect(() => { if (status === "ready" || status === "error") void refresh(); }, [status, refresh]);

  const run = async (fn: () => Promise<unknown>) => {
    if (busy) return;
    setActionPending(true);
    setError(null);
    try {
      if (!(await editor.save())) return;
      await fn();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setActionPending(false);
    }
  };

  const renderVideos = (ids: string[]) => run(async () => {
    if (!ids.length) return;
    const saved = await api.getProject(initial.id);
    await api.render(initial.id, ids, saved.revision);
  });

  const changeVideos = async (ids: string[], action: "delete" | SequenceStatus) => {
    if (!edl || busy || editor.conflict) return false;
    setError(null);
    setActionPending(true);
    try {
      if (!editor.dispatch(videoActions(edl, ids, action))) return false;
      if (!(await editor.save())) return false;
      selection.clear();
      return true;
    } catch (cause) {
      setError((cause as Error).message);
      return false;
    } finally { setActionPending(false); }
  };

  const openEditor = (video: ProjectVideo) => async (event: React.MouseEvent) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (await editor.save()) router.push(editHref(initial.id, video));
  };

  const remove = (video: ProjectVideo) => {
    if (!window.confirm(`Delete “${video.title}”? This cannot be undone.`)) return;
    const removed = editor.dispatch([
      video.kind === "sequence"
        ? { type: "sequence.remove", sequenceId: video.id }
        : { type: "clip.remove", clipId: video.id },
    ]);
    if (removed && selected?.id === video.id) {
      const index = shown.findIndex((candidate) => candidate.id === video.id);
      setSelectedId(shown[index + 1]?.id ?? shown[index - 1]?.id ?? null);
    }
  };

  /** One click to move a candidate out of triage, the commonest action at forty of them. */
  const approve = (video: ProjectVideo) => {
    if (!video.sequence) return;
    const status = video.status === "approved" || video.status === "rendered" ? "pending" : "approved";
    editor.dispatch([{ type: "sequence.plan.patch", sequenceId: video.id, patch: { status } }]);
  };

  const newVideo = () =>
    run(async () => {
      if (!edl) return;
      const id = crypto.randomUUID().slice(0, 8);
      // A second video in a project that never chose a shape is still waiting for one:
      // it takes the shape of the first video put on it, like the first one did.
      const like = edl.sequences[0];
      editor.dispatch([{ type: "sequence.add", sequence: { id, title: "New video", output: like?.output ?? edl.output,
        ...(like?.autoOutput ? { autoOutput: true } : {}), items: [], plan: emptySequencePlan() } }]);
      if (await editor.save()) router.push(`/p/${initial.id}/edit?sequence=${id}`);
    });

  const onReviewCard = useCallback((id: string | null) => {
    reviewFocus.current = id;
    if (id) setSelectedId(id);
  }, []);
  const openReview = () => setReview((r) => ({ open: true, queue: reviewQueue(shown), session: r.session + 1 }));

  const hasSource = !!edl?.source;
  const pending = edl?.sequences.some((s) => s.plan.status === "pending") ?? false;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-6 px-6 pt-4 pb-10">
      {/* Navigation layer. Controls inside it use fills, never more glass. */}
      <Glass
        shape="capsule"
        thickness="thick"
        className="sticky top-4 z-20 flex flex-wrap items-center gap-3 rounded-3xl px-3 py-3 sm:rounded-full sm:px-4"
      >
        <Button aria-label="Back to projects" variant="ghost" size="icon" className="size-10 shrink-0 bg-foreground/5 ring-1 ring-inset ring-foreground/10" nativeButton={false} render={<Link href="/" />}>
          <ArrowLeft aria-hidden className="size-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <h1 title={project.name} className="truncate text-lg font-semibold tracking-tight">{project.name}</h1>
          {project.probe && <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
            <Film aria-hidden strokeWidth={1.5} className="size-3.5 shrink-0" />
            <span className="truncate">
              {project.probe.width} × {project.probe.height} · {runtime(project.probe.durationSec)}
            </span>
          </p>}
        </div>
        <div role="status" className="max-w-full sm:max-w-64">
          <ProjectStatus status={project.status} running={project.job?.status === "running"} stage={project.job?.stage} />
        </div>
        <ProjectActions project={project} returnToProjects onRenamed={name => setProject(p => ({ ...p, name }))}>
          {edl && <>
            <ContextMenuItem className="min-h-10" disabled={busy || !hasSource} title="Analyze the source again for more highlights" onClick={() => setFinding(true)}>
              <Search aria-hidden strokeWidth={1.5} className="size-4" />Find more
            </ContextMenuItem>
            <ContextMenuItem className="min-h-10" disabled={busy || !pending} title="Transcribe, plan and edit every pending video under the shared plan" onClick={() => run(() => api.runBatch(initial.id, { brief }))}>
              <Sparkles aria-hidden strokeWidth={1.5} className="size-4" />Edit pending videos
            </ContextMenuItem>
            <ContextMenuItem className="min-h-10" disabled={busy || !hasSource} title="Transcribe the source again and refresh the captions on every video, keeping your edits" onClick={() => run(() => api.resyncTranscript(initial.id, { userBrief: brief }))}>
              <Captions aria-hidden strokeWidth={1.5} className="size-4" />Re-sync captions
            </ContextMenuItem>
            <ContextMenuItem className="min-h-10" disabled={busy || !hasSource} title="Start a 30-second cut you trim yourself" onClick={() => {
              editor.dispatch([{ type: "clip.add", clip: Clip.parse({ id: crypto.randomUUID().slice(0, 8), title: "New clip", start: 0, end: Math.min(30, edl.source?.durationSec ?? 0) }) }]);
            }}>
              <Film aria-hidden strokeWidth={1.5} className="size-4" />Add a cut from the source
            </ContextMenuItem>
          </>}
        </ProjectActions>
      </Glass>

      {busy && project.job ? <Progress value={project.job.progress * 100} className="h-1.5" /> : null}
      {error || project.error ? (
        <p role="alert" className="rounded-2xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error ?? project.error}
        </p>
      ) : null}

      {!edl || finding ? (
        <AnalyzePanel
          projectId={initial.id}
          busy={busy}
          make={make}
          onMake={setMake}
          brief={brief}
          onBrief={setBrief}
          cancel={edl ? () => setFinding(false) : null}
          onAnalyze={() => {
            setFinding(false);
            void run(() => api.analyze(initial.id, analyzeOptions(make, brief)));
          }}
        />
      ) : null}

      {/* The overview and the thing it is an overview of, side by side: selecting a
          card has to change something you can see. `minmax(0, …)`, not `1fr`, because
          an auto-minimum track grows to its widest line and one long agent log line
          would stretch the column past the page. */}
      {edl ? (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="flex min-w-0 flex-col gap-6">
            <section aria-labelledby="videos-heading" className="flex flex-col gap-4">
          <Glass className="@container flex flex-col gap-2 p-3">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
            <h2 id="videos-heading" className="px-1 text-sm font-medium tabular-nums">
              {filter === "all" ? count(videos.length, "video", "videos") : `${shown.length} of ${count(videos.length, "video", "videos")}`}
            </h2>
            <div className="ms-auto flex items-center gap-1">
              <Button size="sm" variant="outline" className="min-h-9" disabled={busy} onClick={newVideo}>
                <Video aria-hidden className="size-4" />
                New video
              </Button>
              <Link href={calendarHref(initial.id)} aria-label="Calendar" title="Calendar" className={cn(buttonVariants({ size: "sm", variant: "ghost" }), "min-h-9")}>
                <CalendarDays aria-hidden className="size-4" />
                <span className="hidden sm:inline">Calendar</span>
              </Link>
            </div>
          </div>

          {videos.length > 0 && (
              <VideoSelectionBar
                videos={checkedVideos}
                visibleCount={shown.length}
                all={selection.all}
                busy={busy || editor.conflict}
                error={error || editor.error}
                onSelectAll={selection.selectAll}
                onClear={selection.clear}
                onStatus={status => { void changeVideos(selection.ids, status); }}
                onRender={() => { void renderVideos(selection.ids); }}
                onDelete={ids => changeVideos(ids, "delete")}
                publicationAction={<ProjectPublications projectId={initial.id} sequenceIds={selection.ids} beforeRun={editor.save} disabled={busy || editor.conflict} />}
              >
                <div className="ms-auto flex flex-wrap items-center gap-2">
                  <Select value={filter} onValueChange={value => { if (!value) return; selection.clear(); setFilter(value); }}>
                    <SelectTrigger aria-label="Filter videos by status" className="h-9 rounded-full border-transparent bg-white/5 px-3 text-xs shadow-none">
                      <SlidersHorizontal aria-hidden className="size-3.5" />
                      <SelectValue>{value => value === "all" ? "All statuses" : STATUS[value as SequenceStatus]?.label}</SelectValue>
                    </SelectTrigger>
                    <SelectContent align="start" alignItemWithTrigger={false}>
                      {FILTERS.map(({ value, label }) => (
                        <SelectItem key={value} value={value}>
                          {value !== "all" && <StatusIcon status={value} />}
                          {value === "all" ? "All statuses" : label}
                          <span className="ms-auto text-muted-foreground tabular-nums">{counts[value]}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <VideoViewOptions layout={layout} sort={sort} onLayout={setLayout} onSort={setSort} reviewing={review.open} onReview={shown.length ? openReview : undefined} />
                </div>
              </VideoSelectionBar>
          )}
          </Glass>

          {videos.length ? (
            <>

              {/* The pane scrolls, not the page: at forty candidates a page that grows
                  with the list pushes the preview, the agent and every action below
                  five screens of rows. */}
              <div className="relative">
                <div className="-mx-2 overflow-y-auto px-2 py-1 [scrollbar-gutter:stable] lg:max-h-[calc(100dvh-19rem)] lg:min-h-80">
                  {shown.length ? (
                    <ClipList
                      layout={layout}
                      videos={shown}
                      projectId={initial.id}
                      revision={revision}
                      selectedId={selected?.id ?? null}
                      rendered={project.rendered}
                      checkedIds={selection.ids}
                      onToggle={selection.toggle}
                      handlers={{
                        onSelect: setSelectedId,
                        onOpen: openEditor,
                        onApprove: approve,
                        onDelete: remove,
                        href: (video) => editHref(initial.id, video),
                      }}
                    />
                  ) : (
                    <p className="px-2 py-8 text-center text-sm text-muted-foreground">
                      No {STATUS[filter as SequenceStatus]?.label.toLowerCase()} videos.{" "}
                      <button type="button" className="underline underline-offset-4" onClick={() => setFilter("all")}>Show all</button>
                    </p>
                  )}
                </div>
              </div>
            </>
          ) : (
            <Card className="items-center gap-2 p-10 text-center">
              <Film aria-hidden className="size-7 text-muted-foreground" />
              <p className="font-medium">No videos yet</p>
              <p className="max-w-sm text-sm text-muted-foreground">
                {hasSource
                  ? "Find the highlights in this source, or start an empty canvas and build one yourself."
                  : "Start an empty canvas and place your footage, titles and audio on it."}
              </p>
              <div className="mt-2 flex flex-wrap justify-center gap-2">
                {hasSource && (
                  <Button disabled={busy} onClick={() => setFinding(true)}>
                    <Sparkles aria-hidden />
                    Find highlights
                  </Button>
                )}
                <Button variant="outline" disabled={busy} onClick={newVideo}>
                  <Video aria-hidden />
                  New video
                </Button>
              </div>
            </Card>
          )}
            </section>

            <Card className="min-w-0 gap-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
              <h2 className="text-base font-medium">Agent</h2>
              <EditorStatus editor={editor} />
            </div>
            <AgentEditor
              projectId={initial.id}
              controller={chat}
              selection={selected ? { id: selected.id, title: selected.title } : null}
            />
            </Card>
          </div>

          {/* One player at a time: the deck plays the same video full size. */}
          {selected && !review.open ? (
            <aside aria-label="Selected video" className="flex flex-col gap-3 lg:sticky lg:top-24 lg:self-start">
            <VideoPreview projectId={initial.id} video={selected} edl={edl} assetUrls={assetUrls} />
            <Card className="gap-3 p-4">
              <div className="min-w-0">
                <h2 className="text-sm leading-snug font-medium text-balance">{selected.title}</h2>
                <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                  {runtime(selected.durationSec)} · {count(selected.shots, "shot", "shots")}
                  {selected.tags.length ? ` · ${selected.tags.join(", ")}` : ""}
                </p>
                {selected.summary ? (
                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground text-pretty">{selected.summary}</p>
                ) : null}
                {selected.error ? (
                  <p role="alert" className="mt-2 text-xs text-destructive">
                    This video failed to edit: {selected.error}
                  </p>
                ) : null}
              </div>

              {selected.sequence ? (
                <div className="flex flex-col gap-1.5">
                  <Label id={statusId} className="text-xs text-muted-foreground">Status</Label>
                  <Select
                    value={selected.status}
                    onValueChange={(v) =>
                      editor.dispatch([{ type: "sequence.plan.patch", sequenceId: selected.id, patch: { status: v as SequenceStatus } }])
                    }
                  >
                    <SelectTrigger aria-labelledby={statusId} size="sm" className="w-full capitalize">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STATUSES.map((s) => (
                        <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  A suggested cut. It becomes an editable timeline the first time you change it.
                </p>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={editHref(initial.id, selected)}
                  onClick={openEditor(selected)}
                  className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                >
                  <SlidersHorizontal aria-hidden />
                  Open editor
                </Link>
                <Button size="sm" disabled={busy} onClick={() => renderVideos([selected.id])}>
                  {busy ? <Loader2 aria-hidden className="motion-safe:animate-spin" /> : <Clapperboard aria-hidden />}
                  Render
                </Button>
                {project.rendered.includes(selected.id) && (
                  <a
                    download
                    href={clipUrl(initial.id, selected.id)}
                    className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
                  >
                    <Download aria-hidden />
                    Download
                  </a>
                )}
              </div>
            </Card>
            </aside>
          ) : null}
        </div>
      ) : null}

      {edl && review.session > 0 ? (
        <ReviewDeck
          key={review.session}
          open={review.open}
          onOpenChange={(open) => setReview((r) => ({ ...r, open }))}
          queue={review.queue}
          videos={videos}
          edl={edl}
          projectId={initial.id}
          revision={revision}
          assetUrls={assetUrls}
          chat={chat}
          editor={editor}
          busy={busy || editor.conflict}
          onCurrent={onReviewCard}
          onVerdict={(video, status) => changeVideos([video.id], status)}
          onRender={(ids) => { void renderVideos(ids); }}
          href={(video) => editHref(initial.id, video)}
          onOpenEditor={openEditor}
        />
      ) : null}
    </main>
  );
}

/**
 * Asking the agent for something out of the source.
 *
 * The form used to be one number, because there was one answer: six vertical clips. A
 * template says what kind of video it makes now, so this asks which of those and then
 * the one question that kind has — how many clips, or how long the video runs.
 */
function AnalyzePanel({
  projectId,
  busy,
  make,
  onMake,
  brief,
  onBrief,
  cancel,
  onAnalyze,
}: {
  projectId: string;
  busy: boolean;
  make: MakeChoice;
  onMake: (choice: MakeChoice) => void;
  brief: string;
  onBrief: (s: string) => void;
  cancel: (() => void) | null;
  onAnalyze: () => void;
}) {
  const { templates } = useTemplates();
  const countId = useId();
  const briefId = useId();
  const templateFieldId = useId();
  const forMode = useMemo(() => templates.filter(t => t.makes.mode === make.mode), [templates, make.mode]);
  const chosen = forMode.find(t => t.id === make.templateId) ?? null;
  const section = make.mode === "section";
  const minutes = make.minutes || Math.round((chosen?.makes.targetSec ?? ((chosen?.makes.minSec ?? 1200) + (chosen?.makes.maxSec ?? 5400)) / 2) / 60);

  // Choosing a kind chooses a template for it, because a long video without one has no
  // shape to be cut to: the only thing that knows a section is wanted is a template.
  const pickMode = (mode: MakeChoice["mode"]) => {
    const first = templates.find(t => t.makes.mode === mode);
    onMake({ ...make, mode, templateId: mode === "section" ? first?.id ?? "" : "", minutes: 0 });
  };

  return (
    <Card className="gap-4 p-5">
      <div>
        <h2 className="text-base font-medium">{section ? "Cut one long video" : "Find the highlights"}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {section
            ? "The agent reads the whole recording, decides which part of it is the video, and keeps the stretches that belong in it — in order, with the rest dropped."
            : "The agent watches the source and proposes the moments worth cutting."}
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <Label className="text-xs text-muted-foreground">What to make</Label>
        <div className="flex flex-wrap gap-2">
          {MAKES.map(option => (
            <button
              key={option.mode}
              type="button"
              aria-pressed={make.mode === option.mode}
              onClick={() => pickMode(option.mode)}
              className={cn(
                "flex min-w-40 flex-col items-start gap-0.5 rounded-xl border px-3 py-2 text-left transition-colors",
                make.mode === option.mode ? "border-primary/60 bg-primary/10" : "border-white/10 hover:bg-white/5",
              )}
            >
              <span className="text-sm">{option.label}</span>
              <span className="text-[11px] leading-snug text-muted-foreground">{option.note}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor={templateFieldId} className="text-xs text-muted-foreground">Template</Label>
        <Select value={make.templateId || "none"} onValueChange={value => onMake({ ...make, templateId: value && value !== "none" ? value : "", minutes: 0 })}>
          <SelectTrigger id={templateFieldId} className="w-full sm:w-80"><SelectValue /></SelectTrigger>
          <SelectContent>
            {!section && <SelectItem value="none">No template — clips as found</SelectItem>}
            {forMode.map(template => <SelectItem key={template.id} value={template.id}>{template.name}</SelectItem>)}
          </SelectContent>
        </Select>
        {chosen?.description ? <p className="text-[11px] leading-snug text-muted-foreground">{chosen.description}</p> : null}
        {section && !forMode.length ? <p className="text-[11px] leading-snug text-muted-foreground">No template on this machine makes a long video yet. Save one whose <code>selection.mode</code> is <code>section</code>.</p> : null}
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor={briefId} className="text-xs text-muted-foreground">Direction (optional)</Label>
        <Textarea
          id={briefId}
          rows={2}
          value={brief}
          onChange={(e) => onBrief(e.target.value)}
          placeholder={section
            ? "The two hours about the Postgres migration. Skip the start, I was waiting on a build."
            : "Focus on the pricing discussion. Punchy cuts, no long setups."}
        />
        {section ? <p className="text-[11px] leading-snug text-muted-foreground">Say which part of the recording, if you already know. It is the instruction that wins over everything else.</p> : null}
      </div>
      <SourceTranscript projectId={projectId} locked={busy} />
      <AgentPicker projectId={projectId} locked={busy} lockedReason="the analysis is running" />
      <div className="flex flex-wrap items-end gap-3">
        {section ? (
          <div className="flex w-36 flex-col gap-2">
            <Label htmlFor={countId} className="text-xs text-muted-foreground">How long (minutes)</Label>
            <Input id={countId} type="number" min={5} max={240} value={minutes} onChange={(e) => onMake({ ...make, minutes: Number(e.target.value) })} />
          </div>
        ) : (
          <div className="flex w-28 flex-col gap-2">
            <Label htmlFor={countId} className="text-xs text-muted-foreground">How many</Label>
            <Input id={countId} type="number" min={1} max={200} value={make.count} onChange={(e) => onMake({ ...make, count: Number(e.target.value) })} />
          </div>
        )}
        <Button disabled={busy || (section && !make.templateId)} onClick={onAnalyze}>
          {busy ? <Loader2 aria-hidden className="motion-safe:animate-spin" /> : <Sparkles aria-hidden />}
          {section ? "Cut the video" : "Find highlights"}
        </Button>
        {cancel && (
          <Button variant="ghost" onClick={cancel}>Cancel</Button>
        )}
      </div>
    </Card>
  );
}
