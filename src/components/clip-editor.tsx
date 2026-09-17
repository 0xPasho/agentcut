"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Player, type PlayerRef } from "@remotion/player";
import { ArrowLeft, Check, Loader2, Plus, Scissors, Wand2 } from "lucide-react";
import { ClipComposition } from "@/../remotion/ClipComposition";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Glass } from "@/components/ui/glass";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Timeline } from "@/components/timeline";
import { ClipInspector } from "@/components/clip-inspector";
import { CaptionControls } from "@/components/caption-controls";
import { api, assetUrl, sourceUrl } from "@/lib/client";
import { buildTimeMap, srcToOut } from "@/lib/timeline";
import { fmt } from "@/lib/transcript";
import type { CaptionStyle, Clip, Edit, Edl } from "@/lib/edl";

const NEW_EDIT: Record<string, (t: number) => Edit> = {
  silence: (t) => ({ type: "silence", t, d: 0.4 }),
  punch: (t) => ({ type: "punch", t, d: 1.2, scale: 1.12 }),
  emphasis: (t) => ({ type: "emphasis", t, d: 1, words: [], color: "#ffe600" }),
  text: (t) => ({ type: "text", t, d: 3, text: "New title", position: "top", style: "card" }),
};

export function ClipEditor({
  projectId,
  projectName,
  edl: initialEdl,
  clipId,
}: {
  projectId: string;
  projectName: string;
  edl: Edl;
  clipId: string;
}) {
  const [edl, setEdl] = useState(initialEdl);
  const [selected, setSelected] = useState<number | null>(null);
  const [currentSec, setCurrentSec] = useState(0);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [rendering, setRendering] = useState(false);
  const player = useRef<PlayerRef>(null);

  const clip = useMemo(
    () => edl.clips.find((c) => c.id === clipId) ?? edl.clips[0],
    [edl, clipId],
  );
  const map = useMemo(() => buildTimeMap(clip), [clip]);
  const fps = edl.output.fps;

  // The Player owns the playhead; mirror it so the timeline can follow.
  useEffect(() => {
    const p = player.current;
    if (!p) return;
    const onFrame = () => setCurrentSec(p.getCurrentFrame() / fps);
    p.addEventListener("frameupdate", onFrame);
    return () => p.removeEventListener("frameupdate", onFrame);
  }, [fps]);

  const seek = useCallback(
    (sec: number) => {
      player.current?.seekTo(Math.round(sec * fps));
      setCurrentSec(sec);
    },
    [fps],
  );

  const update = useCallback(
    (next: Clip) => {
      setEdl((prev) => ({ ...prev, clips: prev.clips.map((c) => (c.id === next.id ? next : c)) }));
      setDirty(true);
    },
    [],
  );

  const save = async () => {
    setSaving(true);
    try {
      await api.saveEdl(projectId, edl);
      setDirty(false);
    } finally {
      setSaving(false);
    }
  };

  const render = async () => {
    setRendering(true);
    try {
      if (dirty) await api.saveEdl(projectId, edl);
      setDirty(false);
      await api.render(projectId, [clip.id]);
    } finally {
      setRendering(false);
    }
  };

  /** Playhead is in output time; edits are authored in source time. */
  const playheadInSource = useMemo(() => {
    const span = map.spans.find(
      (s) => currentSec >= s.outStart && currentSec <= s.outStart + (s.srcEnd - s.srcStart),
    );
    return span ? span.srcStart + (currentSec - span.outStart) : currentSec;
  }, [map, currentSec]);

  const addEdit = (kind: keyof typeof NEW_EDIT) => {
    const next = { ...clip, edits: [...clip.edits, NEW_EDIT[kind](playheadInSource)] };
    update(next);
    setSelected(next.edits.length - 1);
  };

  const words = clip.words;

  const assetUrls = useMemo(() => {
    const out: Record<string, string> = {};
    for (const e of clip.edits) {
      if ((e.type === "image" || e.type === "sfx" || e.type === "music") && e.src) {
        out[e.src] = assetUrl(projectId, e.src);
      }
    }
    return out;
  }, [clip.edits, projectId]);

  return (
    // Editor shell: the viewport is the frame. Each region scrolls on its own
    // rather than the page growing, so the preview never leaves the screen.
    <div className="flex h-screen flex-col overflow-hidden">
      {/* Navigation layer. In flow, not floating over the preview — glass must not
          intersect content in a steady state. */}
      <Glass shape="capsule" className="mx-5 mt-4 flex shrink-0 flex-wrap items-center gap-3 px-4 py-2.5">
        <Button variant="ghost" size="icon" render={<Link href={`/p/${projectId}`} />}>
          <ArrowLeft className="size-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-medium">{clip.title}</h1>
          <p className="truncate font-mono text-xs text-muted-foreground">
            {projectName} · {fmt(clip.start)}–{fmt(clip.end)}
          </p>
        </div>
        <Button variant="outline" size="sm" disabled={!dirty || saving} onClick={save}>
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
          {dirty ? "Save" : "Saved"}
        </Button>
        <Button size="sm" disabled={rendering} onClick={render}>
          {rendering ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4" />}
          Render
        </Button>
      </Glass>

      <div className="flex min-h-0 flex-1 gap-5 px-5 pt-4 pb-5">
        <section className="flex min-h-0 flex-1 flex-col gap-3">
          {/* The preview takes the height it can and derives its width from it,
              so a 9:16 clip never pushes the timeline off screen. */}
          <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden">
            <div className="h-full max-h-full" style={{ aspectRatio: "9 / 16" }}>
              <Player
                ref={player}
                component={ClipComposition}
                inputProps={{
                  clip,
                  sourceUrl: sourceUrl(projectId),
                  sourceWidth: edl.source.width,
                  sourceHeight: edl.source.height,
                  assetBase: `/api/projects/${projectId}/asset/`,
                  assetUrls,
                }}
                durationInFrames={Math.max(1, Math.round(map.duration * fps))}
                fps={fps}
                compositionWidth={edl.output.width}
                compositionHeight={edl.output.height}
                controls
                acknowledgeRemotionLicense
                className="overflow-hidden rounded-2xl border border-border bg-black"
                style={{ width: "100%", height: "100%" }}
              />
            </div>
          </div>

          <Card className="shrink-0 py-3">
            <CardContent className="flex flex-col gap-2.5 px-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="mr-auto text-xs text-muted-foreground">Add at playhead</span>
                {(Object.keys(NEW_EDIT) as Array<keyof typeof NEW_EDIT>).map((kind) => (
                  <Button key={kind} size="xs" variant="outline" onClick={() => addEdit(kind)}>
                    <Plus className="size-3" />
                    {kind}
                  </Button>
                ))}
              </div>
              <Timeline
                clip={clip}
                currentSec={currentSec}
                selected={selected}
                onSelect={setSelected}
                onSeek={seek}
              />
            </CardContent>
          </Card>
        </section>

        <aside className="flex w-[340px] min-h-0 shrink-0 flex-col gap-3 overflow-y-auto pr-1">
          <Card className="shrink-0 p-4">
            <Tabs
              value={selected !== null ? "edit" : "captions"}
              onValueChange={(v) => {
                if (v === "captions") setSelected(null);
              }}
            >
              <TabsList className="w-full">
                <TabsTrigger value="captions" className="flex-1">
                  Captions
                </TabsTrigger>
                <TabsTrigger value="edit" className="flex-1" disabled={selected === null}>
                  Selected
                </TabsTrigger>
              </TabsList>

              <TabsContent value="captions" className="pt-4">
                <CaptionControls
                  value={clip.captions}
                  onChange={(captions: CaptionStyle) => update({ ...clip, captions })}
                />
              </TabsContent>

              <TabsContent value="edit" className="pt-4">
                {selected !== null && clip.edits[selected] ? (
                  <ClipInspector
                    projectId={projectId}
                    edit={clip.edits[selected]}
                    onChange={(next) =>
                      update({
                        ...clip,
                        edits: clip.edits.map((e, i) => (i === selected ? next : e)),
                      })
                    }
                    onRemove={() => {
                      update({ ...clip, edits: clip.edits.filter((_, i) => i !== selected) });
                      setSelected(null);
                    }}
                  />
                ) : (
                  <p className="text-xs text-muted-foreground">Pick a block on the timeline.</p>
                )}
              </TabsContent>
            </Tabs>
          </Card>

          <Card className="flex min-h-0 shrink-0 flex-col gap-0 py-0">
            <div className="px-4 py-2.5 text-xs text-muted-foreground">
              Transcript — click to seek, double-click to trim the start
            </div>
            <Separator />
            <ScrollArea className="h-64">
              <div className="flex flex-wrap gap-x-1 gap-y-1.5 p-4 text-sm leading-relaxed">
                {words.map((w, i) => {
                  const out = srcToOut(map, w.t);
                  const active = currentSec >= out && currentSec < out + w.d;
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => seek(out)}
                      onDoubleClick={() => update({ ...clip, start: clip.start + w.t })}
                      title={`${fmt(out)} — double-click to trim the start here`}
                      className={`rounded-md px-1 outline-none transition-colors hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-ring ${
                        active ? "bg-primary/25 text-primary" : ""
                      }`}
                    >
                      {w.w}
                    </button>
                  );
                })}
              </div>
            </ScrollArea>
          </Card>

          <Card className="shrink-0">
            <CardContent className="flex flex-col gap-1.5 px-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-2 text-foreground">
                <Scissors className="size-3.5" />
                {(clip.end - clip.start).toFixed(1)}s source · {map.duration.toFixed(1)}s after cuts
              </span>
              <span>
                {clip.edits.length} edits · {clip.words.length} words
              </span>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}
