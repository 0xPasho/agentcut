"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Download, Loader2, Play, SlidersHorizontal, Sparkles, Trash2, Wand2 } from "lucide-react";
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
import { api, clipUrl, sourceUrl, thumbUrl, type LogEvent, type ProjectDetail } from "@/lib/client";
import { fmt } from "@/lib/transcript";
import type { CaptionStyle, Edit, Edl } from "@/lib/edl";

const BUSY = new Set(["download", "probe", "transcribe", "signals", "agent", "rendering", "bundling"]);

export function ProjectView({ initial }: { initial: ProjectDetail }) {
  const [project, setProject] = useState(initial);
  const [events, setEvents] = useState<LogEvent[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(initial.edl?.clips[0]?.id ?? null);
  const [clipCount, setClipCount] = useState(6);
  const [brief, setBrief] = useState("");
  const [saving, setSaving] = useState(false);
  const [reanalyzing, setReanalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const edl = project.edl;
  const busy = BUSY.has(project.status) || project.job?.status === "running";
  const selected = useMemo(
    () => edl?.clips.find((c) => c.id === selectedId) ?? edl?.clips[0] ?? null,
    [edl, selectedId],
  );

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

    es.addEventListener("log", (e) => {
      const data = JSON.parse((e as MessageEvent).data) as LogEvent;
      setEvents((prev) => (prev.some((p) => p.id === data.id) ? prev : [...prev, data].slice(-400)));
    });

    es.addEventListener("status", (e) => {
      const data = JSON.parse((e as MessageEvent).data) as {
        status: string;
        error: string | null;
        job: ProjectDetail["job"];
      };
      setProject((p) => ({ ...p, status: data.status, error: data.error, job: data.job }));
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
      await fn();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const patchClip = async (patch: { captions?: CaptionStyle; edits?: Edit[] }) => {
    if (!edl || !selected) return;
    const next: Edl = {
      ...edl,
      clips: edl.clips.map((c) => (c.id === selected.id ? { ...c, ...patch } : c)),
    };
    setProject((p) => ({ ...p, edl: next }));
    setSaving(true);
    try {
      await api.saveEdl(initial.id, next);
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-6 px-6 py-8">
      {/* Navigation layer. Controls inside it use fills, never more glass. */}
      <Glass shape="capsule" className="sticky top-4 z-20 flex flex-wrap items-center gap-3 px-4 py-2.5">
        <Button variant="ghost" size="icon" render={<Link href="/" />}>
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
          {busy && <Loader2 className="mr-1 size-3 animate-spin" />}
          {project.job?.stage ?? project.status}
        </Badge>
      </Glass>

      {busy && project.job ? <Progress value={project.job.progress * 100} className="h-1.5" /> : null}
      {error || project.error ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error ?? project.error}
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="flex flex-col gap-4">
          {!edl || reanalyzing ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base font-semibold">Find the clips</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="flex items-end gap-3">
                  <div className="flex w-28 flex-col gap-2">
                    <Label className="text-xs text-muted-foreground">How many</Label>
                    <Input
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
                    {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                    Analyze with agent
                  </Button>
                </div>
                <div className="flex flex-col gap-2">
                  <Label className="text-xs text-muted-foreground">Direction (optional)</Label>
                  <Textarea
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
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => setReanalyzing(true)}>
                    <Sparkles className="size-3.5" />
                    Find again
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
                        onClick={(e) => e.stopPropagation()}
                        render={<Link href={`/p/${initial.id}/c/${clip.id}`} />}
                      >
                        <SlidersHorizontal className="size-4" />
                      </Button>
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
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
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
