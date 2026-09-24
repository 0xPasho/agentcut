"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Captions,
  Download,
  Film,
  Loader2,
  MoreHorizontal,
  Plus,
  Search,
  SlidersHorizontal,
  Sparkles,
  Wand2,
} from "lucide-react";
import { cn } from "cn";
import { Button, buttonVariants } from "@/common/ui/button";
import { Badge } from "@/common/ui/badge";
import { Card } from "@/common/ui/card";
import { Input } from "@/common/ui/input";
import { Label } from "@/common/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/common/ui/popover";
import { Progress } from "@/common/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/common/ui/select";
import { Textarea } from "@/common/ui/textarea";
import { AgentPicker } from "@/modules/agent/components/agent-picker";
import { Glass, ScrollEdge } from "@/common/ui/glass";
import { ClipList, StatusDot } from "@/modules/project/components/clip-list";
import { STATUS } from "@/modules/project/data";
import { VideoPreview } from "@/modules/editor/components/video-preview";
import { useEditor } from "@/modules/editor/hooks/use-editor";
import { EditorStatus } from "../editor/components/editor-status";
import { useProjectChat } from "@/modules/agent/hooks/use-chat";
import { AgentEditor } from "../agent/components/agent-editor";
import { Clip } from "@/modules/editor/types";
import { emptySequencePlan, type SequenceStatus } from "@/modules/plan/types";
import { api, assetUrl, clipUrl, type ProjectDetail } from "@/common/api/client";
import { useProjectStream } from "@/common/hooks/use-project-stream";
import { count, runtime } from "@/common/lib/format";
import { projectVideos, SORTS, sortVideos, statusCounts, type ProjectVideo, type VideoSort } from "@/modules/project/lib/overview";
import type { Edit } from "@/modules/editor/types";
import { useTemplates } from "@/common/hooks/use-templates";
import { BUSY, STATUSES, FILTERS, MAKES } from "./data";
import type { MakeChoice } from "./types";
import { analyzeOptions, editHref } from "./lib/project-view";

export function ProjectView({ initial }: { initial: ProjectDetail }) {
  const router = useRouter();
  const statusId = useId();
  const sortId = useId();
  const [project, setProject] = useState(initial);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // What to make out of the source, not just how many: the templates on this machine say
  // whether that is a pack of clips or one long video, and this is the answer to that.
  const [make, setMake] = useState<MakeChoice>({ mode: "clips", templateId: "", count: 6, minutes: 0 });
  const [brief, setBrief] = useState("");
  const [finding, setFinding] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [sort, setSort] = useState<VideoSort>("score");
  const [filter, setFilter] = useState<SequenceStatus | "all">("all");
  const editor = useEditor(initial.id, initial.edl ? { edl: initial.edl, revision: initial.revision } : null);
  const chat = useProjectChat(initial.id, { beforeRun: editor.save, afterUndo: editor.reload });
  const [error, setError] = useState<string | null>(null);

  const edl = editor.snapshot?.edl ?? null;
  const revision = editor.snapshot?.revision ?? initial.revision;
  const busy = BUSY.has(project.status) || project.job?.status === "running";

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
  const { status, error: streamError, revision: streamRevision, job } = useProjectStream(initial.id);
  useEffect(() => {
    if (status === null) return;
    setProject((p) => (p.status === status && p.error === streamError && p.job === job ? p : { ...p, status, error: streamError, job }));
  }, [status, streamError, job]);
  // A new revision, or a run that just ended, means the videos and renders on screen
  // are stale — fetch the project itself rather than patching it from the stream.
  useEffect(() => { if (streamRevision) void refresh(); }, [streamRevision, refresh]);
  useEffect(() => { if (status === "ready" || status === "error") void refresh(); }, [status, refresh]);

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    setMenuOpen(false);
    try {
      if (!(await editor.save())) return;
      await fn();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const openEditor = (video: ProjectVideo) => async (event: React.MouseEvent) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (await editor.save()) router.push(editHref(initial.id, video));
  };

  const remove = (video: ProjectVideo) => {
    if (!window.confirm(`Delete “${video.title}”? This cannot be undone.`)) return;
    editor.dispatch([
      video.kind === "sequence"
        ? { type: "sequence.remove", sequenceId: video.id }
        : { type: "clip.remove", clipId: video.id },
    ]);
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

  const hasSource = !!edl?.source;
  const pending = edl?.sequences.some((s) => s.plan.status === "pending") ?? false;
  const approved = edl?.sequences.some((s) => s.plan.status === "approved") ?? false;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-6 px-6 pt-4 pb-10">
      {/* Navigation layer. Controls inside it use fills, never more glass. */}
      <Glass
        shape="capsule"
        thickness="thick"
        className="sticky top-4 z-20 flex flex-wrap items-center gap-3 px-4 py-2.5"
      >
        <Button aria-label="Back to projects" variant="ghost" size="icon" nativeButton={false} render={<Link href="/" />}>
          <ArrowLeft aria-hidden className="size-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold tracking-tight">{project.name}</h1>
          <p className="truncate text-xs text-muted-foreground tabular-nums">
            {project.probe
              ? `${project.probe.width} × ${project.probe.height} · ${runtime(project.probe.durationSec)}`
              : project.sourcePath}
          </p>
        </div>
        <Badge variant={project.status === "error" ? "destructive" : "secondary"}>
          {busy && <Loader2 aria-hidden className="mr-1 size-3 motion-safe:animate-spin" />}
          {project.job?.stage ?? project.status}
        </Badge>
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
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
            <h2 id="videos-heading" className="text-base font-medium tabular-nums">
              {count(videos.length, "video", "videos")}
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                disabled={busy || !hasSource}
                title="Analyze the source again for more highlights"
                onClick={() => setFinding(true)}
              >
                <Search aria-hidden />
                Find more
              </Button>
              <Button size="sm" variant="ghost" disabled={busy || !videos.length} onClick={() => run(() => api.render(initial.id))}>
                <Wand2 aria-hidden />
                Render all
              </Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={newVideo}>
                <Plus aria-hidden />
                New video
              </Button>
              <Popover open={menuOpen} onOpenChange={setMenuOpen}>
                <PopoverTrigger
                  render={
                    <Button size="icon-sm" variant="ghost" aria-label="More project actions">
                      <MoreHorizontal aria-hidden />
                    </Button>
                  }
                />
                <PopoverContent side="bottom" align="end" className="w-64 rounded-2xl p-1.5">
                  <MenuItem
                    disabled={busy || !pending}
                    hint="Transcribe, plan and edit every pending video under the shared plan"
                    onClick={() => run(() => api.runBatch(initial.id, { brief }))}
                  >
                    <Sparkles aria-hidden />
                    Edit pending videos
                  </MenuItem>
                  <MenuItem disabled={busy || !approved} onClick={() => run(() => api.render(initial.id))}>
                    <Wand2 aria-hidden />
                    Render approved videos
                  </MenuItem>
                  <MenuItem
                    disabled={busy || !hasSource}
                    hint="Transcribe the source again and refresh the captions on every video, keeping your edits"
                    onClick={() => run(() => api.resyncTranscript(initial.id, { userBrief: brief }))}
                  >
                    <Captions aria-hidden />
                    Re-sync captions
                  </MenuItem>
                  <MenuItem
                    disabled={busy || !hasSource}
                    hint="Start a 30-second cut you trim yourself"
                    onClick={() => {
                      setMenuOpen(false);
                      editor.dispatch([{ type: "clip.add", clip: Clip.parse({ id: crypto.randomUUID().slice(0, 8), title: "New clip", start: 0, end: Math.min(30, edl.source?.durationSec ?? 0) }) }]);
                    }}
                  >
                    <Film aria-hidden />
                    Add a cut from the source
                  </MenuItem>
                </PopoverContent>
              </Popover>
            </div>
          </div>

          {videos.length ? (
            <>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <div role="group" aria-label="Filter by status" className="flex flex-wrap items-center gap-1">
                  {FILTERS.map(({ value, label }) => (
                    <Button
                      key={value}
                      size="xs"
                      variant={filter === value ? "secondary" : "ghost"}
                      aria-pressed={filter === value}
                      disabled={value !== "all" && counts[value] === 0}
                      onClick={() => setFilter(value)}
                      className="font-normal"
                    >
                      {value !== "all" && <StatusDot status={value} />}
                      {label}
                      <span className="text-muted-foreground tabular-nums">{counts[value]}</span>
                    </Button>
                  ))}
                </div>
                <div className="ms-auto flex items-center gap-2">
                  <Label id={sortId} className="text-xs text-muted-foreground">Sort</Label>
                  <Select value={sort} onValueChange={(v) => setSort(v as VideoSort)}>
                    <SelectTrigger aria-labelledby={sortId} size="sm" className="w-44">
                      <SelectValue>{(v) => SORTS.find((s) => s.value === v)?.label}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {SORTS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* The pane scrolls, not the page: at forty candidates a page that grows
                  with the list pushes the preview, the agent and every action below
                  five screens of rows. */}
              <div className="relative">
                <div className="-mx-2 overflow-y-auto px-2 lg:max-h-[calc(100dvh-19rem)] lg:min-h-80">
                  {shown.length ? (
                    <ClipList
                      videos={shown}
                      projectId={initial.id}
                      revision={revision}
                      selectedId={selected?.id ?? null}
                      rendered={project.rendered}
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
                <ScrollEdge edge="bottom" className="hidden h-10 rounded-b-3xl lg:block" />
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
                  <Plus aria-hidden />
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

          {selected ? (
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
                <Button size="sm" disabled={busy} onClick={() => run(() => api.render(initial.id, [selected.id]))}>
                  {busy ? <Loader2 aria-hidden className="motion-safe:animate-spin" /> : <Wand2 aria-hidden />}
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
    </main>
  );
}

function MenuItem({
  children,
  hint,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  hint?: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={hint}
      onClick={onClick}
      className="flex w-full cursor-pointer items-center gap-2 rounded-xl px-2.5 py-2 text-left text-sm outline-none transition-colors duration-150 ease-out hover:bg-white/8 focus-visible:bg-white/8 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground"
    >
      {children}
    </button>
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
            <Input id={countId} type="number" min={1} max={20} value={make.count} onChange={(e) => onMake({ ...make, count: Number(e.target.value) })} />
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
