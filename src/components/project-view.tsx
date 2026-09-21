"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Captions, Download, Loader2, Play, SlidersHorizontal, Sparkles, Trash2, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { AgentLog } from "@/components/agent-log";
import { Glass, ScrollEdge } from "@/components/ui/glass";
import { CaptionControls } from "@/components/caption-controls";
import { OverlayEditor } from "@/components/overlay-editor";
import { ClipPreview } from "@/components/clip-preview";
import { patchFromClip } from "@/lib/editor/operations";
import { useEditor } from "@/lib/editor/use-editor";
import { EditorStatus } from "./editor-status";
import { AgentEditor } from "./agent-editor";
import { Clip } from "@/lib/edl";
import { emptySequencePlan } from "@/lib/plan/schema";
import { api, assetUrl, clipUrl, sourceUrl, thumbUrl, type LogEvent, type ProjectDetail } from "@/lib/client";
import { fmt } from "@/lib/transcript";
import { sequenceFrames } from "@/lib/sequences";
import type { CaptionStyle, Edit } from "@/lib/edl";

const BUSY = new Set(["download", "probe", "transcribe", "signals", "agent", "rendering", "bundling"]);

export function ProjectView({ initial }: { initial: ProjectDetail }) {
  const router = useRouter();
  const [project, setProject] = useState(initial);
  const [events, setEvents] = useState<LogEvent[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(initial.edl?.clips[0]?.id ?? null);
  const [clipCount, setClipCount] = useState(6);
  const [brief, setBrief] = useState("");
  const editor = useEditor(initial.id, initial.edl ? { edl: initial.edl, revision: initial.revision } : null);
  const saving = editor.saving;
  const [reanalyzing, setReanalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const edl = editor.snapshot?.edl ?? null;
  const busy = BUSY.has(project.status) || project.job?.status === "running";
  const selected = useMemo(
    () => edl?.clips.find((c) => c.id === selectedId) ?? edl?.clips[0] ?? null,
    [edl, selectedId],
  );

  const assetUrls = useMemo(() => {
    const out: Record<string, string> = {};
    for (const c of edl?.clips ?? []) {
      for (const e of c.edits) {
        if ((e.type === "image" || e.type === "sfx" || e.type === "music") && e.src) {
          out[e.src] = assetUrl(initial.id, e.src);
        }
      }
    }
    return out;
  }, [edl, initial.id]);

  const refresh = useCallback(async () => {
    try {
      setProject(await api.getProject(initial.id));
    } catch {
      // transient; the SSE status keeps flowing
    }
  }, [initial.id]);

  useEffect(() => {
    const es = new EventSource(`/api/projects/${initial.id}/events`);
    let lastStatus = initial.status;
    let lastRevision = initial.revision;

    es.addEventListener("log", (e) => {
      const data = JSON.parse((e as MessageEvent).data) as LogEvent;
      setEvents((prev) => (prev.some((p) => p.id === data.id) ? prev : [...prev, data].slice(-400)));
    });

    es.addEventListener("status", (e) => {
      const data = JSON.parse((e as MessageEvent).data) as {
        status: string;
        revision: number;
        error: string | null;
        job: ProjectDetail["job"];
      };
      setProject((p) => ({ ...p, status: data.status, error: data.error, job: data.job }));
      if (data.revision !== lastRevision) { lastRevision = data.revision; void refresh(); }
      if (data.status !== lastStatus) {
        lastStatus = data.status;
        if (data.status === "ready" || data.status === "error") void refresh();
      }
    });

    return () => es.close();
  }, [initial.id, initial.status, refresh]);

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      if (!(await editor.save())) return;
      await fn();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const patchClip = (patch: { captions?: CaptionStyle; edits?: Edit[] }) => {
    if (selected) editor.dispatch([patchFromClip(selected, { ...selected, ...patch })]);
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-6 px-6 pt-4 pb-10">
      {/* Navigation layer. Controls inside it use fills, never more glass. */}
      <Glass
        shape="capsule"
        thickness="thick"
        className="sticky top-4 z-20 flex flex-wrap items-center gap-3 px-4 py-2.5"
      >
        <Button aria-label="Back to projects" variant="ghost" size="icon" render={<Link href="/" />}>
          <ArrowLeft className="size-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold tracking-tight">{project.name}</h1>
          <p className="truncate font-mono text-xs text-muted-foreground">
            {project.probe
              ? `${project.probe.width}×${project.probe.height} · ${Math.round(project.probe.durationSec)}s`
              : project.sourcePath}
          </p>
        </div>
        <Badge variant={project.status === "error" ? "destructive" : "secondary"}>
          {busy && <Loader2 className="mr-1 size-3 motion-safe:animate-spin" />}
          {project.job?.stage ?? project.status}
        </Badge>
      </Glass>

      {edl && <Card className="flex flex-wrap items-start justify-between gap-4 p-5 sm:flex-row sm:items-center"><div><h2 className="font-medium">Your videos</h2><p className="mt-1 text-sm text-muted-foreground">Open any video in the editor, or start an empty canvas.</p></div><div className="flex flex-wrap gap-2">
        {edl.sequences.some((s) => s.plan.status === "pending") && <Button size="sm" variant="outline" disabled={busy} title="Transcribe, plan and edit every pending video under the shared plan" onClick={() => run(() => api.runBatch(initial.id, { brief }))}>{busy ? <Loader2 className="size-3.5 motion-safe:animate-spin" /> : <Sparkles className="size-3.5" />}Edit pending videos</Button>}
        {edl.sequences.some((s) => s.plan.status === "approved") && <Button size="sm" disabled={busy} title="Render every approved video" onClick={() => run(() => api.render(initial.id))}><Wand2 className="size-3.5" />Render approved</Button>}
      </div><Button variant="outline" onClick={() => run(async () => {
        const id = crypto.randomUUID().slice(0, 8);
        editor.dispatch([{ type: "sequence.add", sequence: { id, title: "New video", output: edl.output, items: [], plan: emptySequencePlan() } }]);
        if (await editor.save()) router.push(`/p/${initial.id}/edit?sequence=${id}`);
      })}>New video</Button></Card>}
      {busy && project.job ? <Progress value={project.job.progress * 100} className="h-1.5" /> : null}
      {error || project.error ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error ?? project.error}
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="flex flex-col gap-4">
          {edl?.sequences.map((sequence) => (
            <Card key={sequence.id} className="gap-3 p-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2"><h2 className="min-w-0 truncate text-sm font-medium">{sequence.title}</h2><Badge variant={sequence.plan.status === "approved" || sequence.plan.status === "rendered" ? "default" : "outline"} className="shrink-0 text-[10px]">{sequence.plan.status}</Badge></div>
                <p className="mt-1 text-xs text-muted-foreground">{sequence.items.length ? `${fmt(sequenceFrames(sequence).duration / sequence.output.fps)} · ${sequence.items.length} timeline items` : "Empty canvas"}{sequence.plan.tags.length ? ` · ${sequence.plan.tags.join(", ")}` : ""}</p>
                {sequence.plan.summary && <p className="mt-1 truncate text-xs text-muted-foreground">{sequence.plan.summary}</p>}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" render={<Link href={`/p/${initial.id}/edit?sequence=${sequence.id}`} />} onClick={async (event) => {
                  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                  event.preventDefault();
                  if (await editor.save()) router.push(`/p/${initial.id}/edit?sequence=${sequence.id}`);
                }}><SlidersHorizontal className="size-3.5" />Open editor</Button>
                {project.rendered.includes(sequence.id) && <Button size="sm" variant="ghost" render={<a href={clipUrl(initial.id, sequence.id)} download />}><Download className="size-3.5" />Download</Button>}
                <select aria-label={`Status of ${sequence.title}`} className="h-8 rounded-xl border border-border bg-background px-2 text-xs focus-visible:outline-2 focus-visible:outline-ring" value={sequence.plan.status} onChange={(e) => editor.dispatch([{ type: "sequence.plan.patch", sequenceId: sequence.id, patch: { status: e.target.value as "pending" | "edited" | "approved" | "rendered" } }])}>
                  {(["pending", "edited", "approved", "rendered"] as const).map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
                {sequence.plan.reasons.error && <span className="text-xs text-destructive" title={sequence.plan.reasons.error}>failed — {sequence.plan.reasons.error.slice(0, 60)}</span>}
                <Button size="icon-sm" variant="ghost" aria-label={`Delete video ${sequence.title}`} onClick={() => { if (window.confirm(`Delete video “${sequence.title}”?`)) editor.dispatch([{ type: "sequence.remove", sequenceId: sequence.id }]); }}><Trash2 className="size-4" /></Button>
              </div>
            </Card>
          ))}
          {!edl || reanalyzing ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base font-semibold">Find the clips</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="flex items-end gap-3">
                  <div className="flex w-28 flex-col gap-2">
                    <Label className="text-xs text-muted-foreground">How many</Label>
                    <Input aria-label="Number of clips"
                      type="number"
                      min={1}
                      max={20}
                      value={clipCount}
                      onChange={(e) => setClipCount(Number(e.target.value))}
                    />
                  </div>
                  <Button
                    className="flex-1"
                    disabled={busy}
                    onClick={() => {
                      setReanalyzing(false);
                      void run(() => api.analyze(initial.id, { targetClipCount: clipCount, userBrief: brief }));
                    }}
                  >
                    {busy ? <Loader2 className="size-4 motion-safe:animate-spin" /> : <Sparkles className="size-4" />}
                    Analyze with agent
                  </Button>
                </div>
                <div className="flex flex-col gap-2">
                  <Label className="text-xs text-muted-foreground">Direction (optional)</Label>
                  <Textarea aria-label="Direction (optional)"
                    rows={2}
                    value={brief}
                    onChange={(e) => setBrief(e.target.value)}
                    placeholder="Focus on the pricing discussion. Punchy cuts, no long setups."
                  />
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-medium text-muted-foreground">{edl.clips.length} clips</h2>
                <div className="flex gap-2">
                  <Button size="sm" variant="ghost" disabled={busy || !edl.source} onClick={() => setReanalyzing(true)}>
                    <Sparkles className="size-3.5" />
                    Find more clips
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy || !edl.source}
                    title="Transcribe the source again and refresh the captions on every clip, keeping your edits"
                    onClick={() => run(() => api.resyncTranscript(initial.id, { userBrief: brief }))}
                  >
                    <Captions className="size-3.5" />
                    Re-sync captions
                  </Button>
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => run(() => api.render(initial.id))}>
                    <Wand2 className="size-3.5" />
                    Render all
                  </Button>
                </div>
              </div>

              {edl.clips.map((clip) => {
                const isRendered = project.rendered.includes(clip.id);
                const active = clip.id === selected?.id;
                return (
                  <Card
                    key={clip.id}
                    role="button"
                    tabIndex={0}
                    aria-pressed={active}
                    onClick={() => setSelectedId(clip.id)}
                    onKeyDown={(e) => {
                      if (e.target !== e.currentTarget) return;
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelectedId(clip.id);
                      }
                    }}
                    className={`cursor-pointer gap-0 py-3 outline-none transition-colors hover:bg-white/[0.07] focus-visible:ring-2 focus-visible:ring-ring ${
                      active ? "border-primary/40 bg-white/[0.07]" : ""
                    }`}
                  >
                    <CardContent className="flex items-start gap-3 px-4">
                      <div className="relative w-14 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-black">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={thumbUrl(initial.id, clip.id)}
                          alt=""
                          loading="lazy"
                          className="aspect-[9/16] w-full object-cover"
                        />
                        <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent px-1 pt-3 pb-1 text-center text-[10px] font-semibold tabular-nums text-primary">
                          {clip.score}
                        </span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{clip.title}</p>
                        <p className="font-mono text-xs text-muted-foreground">
                          {fmt(clip.start)} – {fmt(clip.end)} · {Math.round(clip.end - clip.start)}s
                          {clip.edits.length ? ` · ${clip.edits.length} edits` : ""}
                        </p>
                        {clip.reason ? (
                          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{clip.reason}</p>
                        ) : null}
                      </div>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Open ${clip.title} in the editor`}
                        onClick={async e => { e.stopPropagation(); if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return; e.preventDefault(); if (await editor.save()) router.push(`/p/${initial.id}/c/${clip.id}`); }}
                        render={<Link href={`/p/${initial.id}/c/${clip.id}`} />}
                      >
                        <SlidersHorizontal className="size-4" />
                      </Button>
                      <Button size="icon-sm" variant="ghost" aria-label={`Delete clip ${clip.title}`} onClick={e => { e.stopPropagation(); if (window.confirm(`Delete clip “${clip.title}”?`)) editor.dispatch([{ type: "clip.remove", clipId: clip.id }]); }}><Trash2 className="size-4" /></Button>
                      {isRendered ? (
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={(e) => e.stopPropagation()}
                          render={<a href={clipUrl(initial.id, clip.id)} download />}
                        >
                          <Download className="size-4" />
                        </Button>
                      ) : null}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}

          {edl && <Card className="p-4"><EditorStatus editor={editor} /><AgentEditor projectId={initial.id} beforeRun={editor.save} afterUndo={editor.reload} />
            <Button variant="outline" disabled={!edl.source} onClick={() => editor.dispatch([{ type: "clip.add", clip: Clip.parse({ id: crypto.randomUUID().slice(0, 8), title: "New clip", start: 0, end: Math.min(30, edl.source?.durationSec ?? 0) }) }])}>Add clip</Button>
          </Card>}
          <Card className="gap-0 py-0">
            <CardHeader className="px-4 py-3">
              <CardTitle className="text-xs font-medium text-muted-foreground">Agent</CardTitle>
            </CardHeader>
            <Separator />
            <div className="relative">
              <ScrollEdge edge="top" className="h-8" />
              <AgentLog events={events} />
            </div>
          </Card>
        </div>

        <aside className="flex flex-col gap-4 lg:sticky lg:top-24 lg:self-start">
          {selected && edl ? (
            <>
              <ClipPreview
                clip={selected}
                edl={edl}
                sourceUrl={sourceUrl(initial.id)}
                assetBase={`/api/projects/${initial.id}/asset/`}
                assetUrls={assetUrls}
              />
              <Glass shape="panel" thickness="thick" className="p-4">
              <Tabs defaultValue="captions">
                <TabsList className="w-full">
                  <TabsTrigger value="captions" className="flex-1">
                    Captions
                  </TabsTrigger>
                  <TabsTrigger value="overlays" className="flex-1">
                    Overlays
                  </TabsTrigger>
                  <TabsTrigger value="edits" className="flex-1">
                    Edits
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="captions" className="pt-4">
                  <CaptionControls value={selected.captions} onChange={(captions) => patchClip({ captions })} />
                </TabsContent>

                <TabsContent value="overlays" className="pt-4">
                  <OverlayEditor
                    projectId={initial.id}
                    clip={selected}
                    onChange={(edits) => patchClip({ edits })}
                  />
                </TabsContent>

                <TabsContent value="edits" className="pt-4">
                  {selected.edits.length ? (
                    <ul className="flex flex-col gap-1.5 font-mono text-xs">
                      {selected.edits.map((e, i) => (
                        <li key={i} className="flex items-center gap-2 rounded-xl bg-white/6 px-2 py-1.5">
                          <Badge variant="outline" className="shrink-0 text-[10px]">
                            {e.type}
                          </Badge>
                          <span className="text-muted-foreground">{fmt(e.t)}</span>
                          <span className="truncate">
                            {e.type === "text"
                              ? e.text
                              : e.type === "image"
                                ? e.src
                                : e.type === "emphasis"
                                  ? e.words.join(" ")
                                  : `${e.d}s`}
                          </span>
                          <Button
                            size="icon-xs"
                            variant="ghost"
                            aria-label="Remove edit"
                            onClick={() =>
                              patchClip({ edits: selected.edits.filter((_, n) => n !== i) })
                            }
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-muted-foreground">No edits on this clip.</p>
                  )}
                </TabsContent>
              </Tabs>
              </Glass>

              <Button
                disabled={busy}
                onClick={() => run(() => api.render(initial.id, [selected.id]))}
                className="w-full"
              >
                {busy ? <Loader2 className="size-4 motion-safe:animate-spin" /> : <Play className="size-4" />}
                Render this clip
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                {saving ? "saving…" : "Changes preview instantly — render to export."}
              </p>
            </>
          ) : (
            <Card className="flex aspect-[9/16] items-center justify-center">
              <p className="px-6 text-center text-sm text-muted-foreground">
                Clips appear here once the agent has analyzed the video.
              </p>
            </Card>
          )}
        </aside>
      </div>
    </main>
  );
}
