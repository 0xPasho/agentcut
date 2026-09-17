"use client";

import { useEffect, useId, useRef, useState, type PointerEvent } from "react";
import { EyeOff, VolumeX, Plus, Film, Music2, Layers, Minus } from "lucide-react";
import type { Edit, MediaSource, VideoSequence } from "@/lib/edl";
import type { EditorOperation } from "@/lib/editor/operations";
import { buildTimelineMove, buildTimelineTrim } from "@/lib/editor/timeline-interactions";
import { sequenceFrames } from "@/lib/sequences";
import { buildTimeMap, srcToOut, type TimeMap } from "@/lib/timeline";
import { Button } from "./ui/button";

const LABEL_WIDTH = 76;
const MEDIA_TYPE = "application/x-agentcut-media";
const EMPTY_MEDIA: MediaSource[] = [];
type Drag = { id: string; kind: "move" | "start" | "end" | "effect"; x: number; y: number; at: number; duration: number; layer: number; index?: number; moved: boolean; snapshot: VideoSequence; scrollLeft: number };
type Ghost = { id: string; at: number; duration: number; layer: number; index?: number; delta: number; kind: Drag["kind"] };
type Props = {
  sequence: VideoSequence; selectedId?: string; dispatch: (ops: EditorOperation[]) => void;
  onSelect: (id: string, seconds: number) => void; onBlank: () => void;
  currentSec: number; onSeek: (seconds: number) => void;
  mediaUrls?: Record<string, string>; media?: MediaSource[];
  selectedEdit?: number | null; onSelectEdit?: (index: number) => void;
  onDropMedia?: (mediaId: string, at: number, layer: number) => void;
  onDropAsset?: (assetId: string, at: number, layer: number) => void;
};

function timeLabel(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${rest.toFixed(rest % 1 > .001 ? 1 : 0).padStart(rest % 1 > .001 ? 4 : 2, "0")}`;
}
function sourceAt(map: TimeMap, output: number) {
  for (const span of map.spans) {
    if (output <= span.outStart + span.srcEnd - span.srcStart) return span.srcStart + Math.max(0, output - span.outStart);
  }
  return map.spans.at(-1)?.srcEnd ?? 0;
}
function effectLabel(edit: Edit) {
  if (edit.type === "text") return edit.text || "Title";
  if (edit.type === "emphasis") return edit.words.join(" ") || "Emphasis";
  return ({ silence: "Cut", punch: "Zoom", image: "Image", music: "Music", sfx: "Sound" } as Record<string, string>)[edit.type] ?? edit.type;
}

/** One sampled frame per visible source item, repeated as a filmstrip. No looping players. */
function Filmstrip({ src, start }: { src: string; start: number }) {
  const [frame, setFrame] = useState<string>();
  useEffect(() => {
    let disposed = false;
    const video = document.createElement("video");
    video.muted = true; video.preload = "metadata"; video.playsInline = true;
    const capture = () => {
      if (disposed || !video.videoWidth) return;
      const canvas = document.createElement("canvas"); canvas.width = 96; canvas.height = 48;
      try {
        canvas.getContext("2d")?.drawImage(video, 0, 0, 96, 48);
        setFrame(canvas.toDataURL("image/jpeg", .6));
      } catch { /* Media previews are decorative; an unavailable frame keeps its type icon. */ }
      video.pause();
    };
    video.addEventListener("loadedmetadata", () => { video.currentTime = Math.min(Math.max(.001, start), Math.max(.001, video.duration - .05)); });
    video.addEventListener("seeked", capture);
    video.src = src;
    return () => { disposed = true; video.pause(); video.removeAttribute("src"); video.load(); };
  }, [src, start]);
  return <span aria-hidden className="pointer-events-none absolute inset-0 opacity-55" style={frame ? { backgroundImage: `url(${frame})`, backgroundSize: "96px 48px", backgroundRepeat: "repeat-x" } : undefined} />;
}

export function SequenceTimeline({ sequence, selectedId, dispatch, onSelect, onBlank, currentSec, onSeek, mediaUrls = {}, media = EMPTY_MEDIA, selectedEdit, onSelectEdit, onDropMedia, onDropAsset }: Props) {
  const viewport = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const ghostRef = useRef<Ghost | null>(null);
  const suppressClick = useRef(false);
  const [availableWidth, setAvailableWidth] = useState(640);
  const [zoom, setZoom] = useState(1);
  const [extraWidth, setExtraWidth] = useState(0);
  const pointer = useRef<{clientX:number;clientY:number;altKey:boolean}|null>(null);
  const animation = useRef<number|null>(null);
  const tick = useRef<()=>void>(()=>{});
  const stopScroll = () => { if(animation.current!==null)cancelAnimationFrame(animation.current);animation.current=null;pointer.current=null; };
  useEffect(()=>()=>{if(animation.current!==null)cancelAnimationFrame(animation.current);},[]);
  useEffect(()=>setExtraWidth(0),[sequence,zoom]);
  const [ghost, setGhostState] = useState<Ghost | null>(null);
  const [externalDrop, setExternalDrop] = useState<{ layer: number; at: number } | null>(null);
  const [notice, setNotice] = useState("");
  const instructionsId = useId();
  const setGhost = (value: Ghost | null) => { ghostRef.current = value; setGhostState(value); };
  const cancelDrag = () => { stopScroll(); drag.current = null; setGhost(null); };
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setAvailableWidth(Math.max(200, entry.contentRect.width - LABEL_WIDTH)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const cancel = (event: KeyboardEvent) => { if (event.key === "Escape") { stopScroll(); if (drag.current) suppressClick.current = true; drag.current = null; ghostRef.current = null; setGhostState(null); setExternalDrop(null); } };
    window.addEventListener("keydown", cancel);
    return () => window.removeEventListener("keydown", cancel);
  }, []);

  const layout = sequenceFrames(sequence);
  const fps = sequence.output.fps;
  const seconds = sequence.items.length ? layout.duration / fps : 10;
  const baseSpan = Math.max(seconds + Math.min(seconds * .08, 3), 5);
  const baseWidth = Math.max(availableWidth, 480) * zoom;
  const scale = baseWidth / baseSpan;
  const width = baseWidth + extraWidth;
  const span = width / scale;
  const layers = [...new Set([0, ...sequence.items.map(item => item.layer ?? 0)])].sort((a, b) => b - a);
  const newLayer = Math.max(...layers) + 1;
  const selected = layout.items.find(({ item }) => item.id === selectedId);
  const selectedMap = selected ? buildTimeMap(selected.item.clip) : null;
  const standalone = (item: VideoSequence["items"][number]) => item.mediaId === null && item.clip.edits.length === 1 && item.clip.edits[0].t === 0 && Math.abs(item.clip.edits[0].d - (item.clip.end - item.clip.start)) < .001;
  const effectTypes = [...new Set(selected && !standalone(selected.item) ? selected.item.clip.edits.map(edit => edit.type) : [])];
  const roundFrame = (value: number) => Math.round(value * fps) / fps;
  const commit = (ops: EditorOperation[], message: string) => {
    try { dispatch(ops); setNotice(message); } catch (error) { setNotice(error instanceof Error ? error.message : "Could not apply edit."); }
  };
  const positionAt = (clientX: number) => {
    const el = viewport.current;
    return Math.max(0, roundFrame((clientX - (el?.getBoundingClientRect().left ?? 0) + (el?.scrollLeft ?? 0) - LABEL_WIDTH) / scale));
  };
  const layerAt = (clientY: number, fallback: number) => {
    const rows = viewport.current?.querySelectorAll<HTMLElement>("[data-timeline-layer]");
    for (const row of rows ?? []) {
      const rect = row.getBoundingClientRect();
      if (clientY >= rect.top && clientY <= rect.bottom) return Number(row.dataset.timelineLayer);
    }
    return fallback;
  };
  const mainOthers = (id: string) => layout.items.filter(({ item }) => item.id !== id && (item.layer ?? 0) === 0).sort((a, b) => a.from - b.from);
  const insertion = (id: string, at: number) => {
    const others = mainOthers(id);
    const found = others.findIndex(entry => at < (entry.from + entry.duration / 2) / fps);
    const index = found < 0 ? others.length : found;
    return { index, at: others.slice(0, index).reduce((sum, entry) => sum + entry.duration / fps, 0) };
  };
  const begin = (event: PointerEvent<HTMLElement>, id: string, kind: Drag["kind"], index?: number) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.focus({ preventScroll: true });
    const entry = layout.items.find(({ item }) => item.id === id);
    if (!entry) return;
    suppressClick.current = false;
    drag.current = { id, kind, x: event.clientX, y: event.clientY, at: entry.from / fps, duration: entry.duration / fps, layer: entry.item.layer ?? 0, index, moved: false, snapshot: sequence, scrollLeft: viewport.current?.scrollLeft ?? 0 };
    event.currentTarget.setPointerCapture(event.pointerId);
    pointer.current={clientX:event.clientX,clientY:event.clientY,altKey:event.altKey};
    if(animation.current===null)animation.current=requestAnimationFrame(()=>tick.current());
  };
  const updateDrag = (event: {clientX:number;clientY:number;altKey:boolean}) => {
    const d = drag.current;
    if (!d) return;
    if (!d.moved && Math.hypot(event.clientX - d.x, event.clientY - d.y) < 4) return;
    d.moved = true;
    const delta = roundFrame((event.clientX - d.x + (viewport.current?.scrollLeft ?? 0) - d.scrollLeft) / scale);
    if (d.kind === "move") {
      const layer = layerAt(event.clientY, d.layer);
      const at = Math.max(0, roundFrame(d.at + delta));
      const target = layer === 0 && event.altKey ? insertion(d.id, positionAt(event.clientX)) : { at, index: undefined };
      setGhost({ id: d.id, kind: d.kind, duration: d.duration, layer, ...target, delta });
    } else if (d.kind === "effect") {
      setGhost({ id: d.id, kind: d.kind, duration: d.duration, layer: d.layer, at: d.at, index: d.index, delta });
    } else {
      try {
        const ops = buildTimelineTrim(d.snapshot, d.id, d.kind, delta, media);
        const patch = ops.find(op => op.type === "item.patch");
        const original = d.snapshot.items.find(item => item.id === d.id)!;
        const change = patch?.type === "item.patch" ? patch.patch : {};
        const start = change.start ?? original.clip.start, end = change.end ?? original.clip.end;
        const shift = start - original.clip.start;
        const edits = change.edits ?? original.clip.edits.flatMap(edit => {
          const t = edit.t - shift, stop = Math.min(end - start, t + edit.d);
          return stop > Math.max(0, t) ? [{ ...edit, t: Math.max(0, t), d: stop - Math.max(0, t) }] : [];
        });
        const clip = { ...original.clip, start, end, edits };
        const duration = buildTimeMap(clip).duration;
        const placement = ops.find(op => op.type === "item.place");
        const at = placement?.type === "item.place" && placement.patch.at != null ? placement.patch.at : d.at;
        setGhost({ id: d.id, kind: d.kind, at, duration, layer: d.layer, delta });
      } catch (error) { setNotice(error instanceof Error ? error.message : "Cannot trim further."); }
    }
  };
  const move = (event: PointerEvent<HTMLElement>) => {
    pointer.current={clientX:event.clientX,clientY:event.clientY,altKey:event.altKey};
    updateDrag(pointer.current);
  };
  tick.current=()=>{
    const d=drag.current,p=pointer.current,el=viewport.current;
    if(!d||!p||!el){animation.current=null;return;}
    if(d.moved){
      const rect=el.getBoundingClientRect();
      const right=Math.max(0,Math.min(1,(p.clientX-(rect.right-48))/48));
      const left=Math.max(0,Math.min(1,(rect.left+LABEL_WIDTH+48-p.clientX)/48));
      const speed=(right-left)*12;
      if(speed>0 && el.scrollLeft+el.clientWidth>=el.scrollWidth-20 && (d.kind==="end"||d.kind==="move"))setExtraWidth(value=>value+120);
      el.scrollLeft+=speed;
      updateDrag(p);
    }
    animation.current=requestAnimationFrame(()=>tick.current());
  };
  const moveEffect = (snapshot: VideoSequence, id: string, index: number, delta: number) => {
    const entry = snapshot.items.find(item => item.id === id);
    if (!entry) return;
    const edit = entry.clip.edits[index];
    if (!edit) return;
    const map = buildTimeMap(entry.clip);
    const output = Math.max(0, Math.min(map.duration, srcToOut(map, edit.t) + delta));
    const t = Math.max(0, Math.min(entry.clip.end - entry.clip.start - edit.d, sourceAt(map, output)));
    const edits = entry.clip.edits.map((value, i) => i === index ? { ...value, t } : value);
    commit([{ type: "item.patch", sequenceId: sequence.id, itemId: id, patch: { edits }, before: { edits: entry.clip.edits } }], "Effect moved.");
  };
  const end = () => {
    const d = drag.current, g = ghostRef.current;
    if (d) suppressClick.current = d.moved;
    if (d?.moved && g) {
      if (d.kind === "move") {
        if (g.layer === 0 && g.index !== undefined) commit([{ type: "item.reorder", sequenceId: sequence.id, itemId: d.id, layer: 0, index: g.index }], "Clip reordered.");
        else commit(buildTimelineMove(d.snapshot, d.id, g.at, g.layer), "Clip moved.");
        onSelect(d.id, g.at);
      } else if (d.kind === "effect") moveEffect(d.snapshot, d.id, d.index!, g.delta);
      else {
        try { commit(buildTimelineTrim(d.snapshot, d.id, d.kind, g.delta, media), "Clip trimmed."); }
        catch (error) { setNotice(error instanceof Error ? error.message : "Could not trim clip."); }
      }
    }
    cancelDrag();
  };
  const dropHandlers = (layer: number) => ({
    onDragOver: (event: React.DragEvent<HTMLDivElement>) => {
      if ((!onDropMedia && !onDropAsset) || !event.dataTransfer.types.includes(MEDIA_TYPE)) return;
      event.preventDefault(); event.dataTransfer.dropEffect = "copy";
      const at = positionAt(event.clientX);
      setExternalDrop({ layer, at });
    },
    onDrop: (event: React.DragEvent<HTMLDivElement>) => {
      const data = event.dataTransfer.getData(MEDIA_TYPE);
      if (!data || (!onDropMedia && !onDropAsset)) return;
      event.preventDefault();
      try {
        const { mediaId, assetId } = JSON.parse(data);
        const at = positionAt(event.clientX);
        if (typeof mediaId === "string") onDropMedia?.(mediaId, at, layer);
        else if (typeof assetId === "string") onDropAsset?.(assetId, at, layer);
      } catch { setNotice("This asset could not be added."); }
      setExternalDrop(null);
    },
  });
  const interval = [0.1, .2, .5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600].find(value => value * scale >= 72) ?? Math.ceil(span / 8 / 3600) * 3600;
  const ticks = Array.from({ length: Math.floor(span / interval) + 1 }, (_, index) => index * interval);
  const sharedPointer = { onPointerMove: move, onPointerUp: end, onPointerCancel: cancelDrag };
  return <div className="flex min-h-0 min-w-0 flex-col gap-2 overflow-hidden">
    <div className="flex flex-wrap items-center gap-2">
      <h2 className="mr-auto text-sm font-medium">Timeline <span className="ml-2 text-xs tabular-nums text-muted-foreground">{sequence.items.length ? `${timeLabel(currentSec)} / ${timeLabel(seconds)}` : "Empty"}</span></h2>
      <Button size="icon-xs" variant="ghost" aria-label="Zoom out timeline" disabled={zoom <= 1} onClick={() => setZoom(value => Math.max(1, value / 1.5))}><Minus /></Button>
      <Button size="icon-xs" variant="ghost" aria-label="Zoom in timeline" disabled={zoom >= 12} onClick={() => setZoom(value => Math.min(12, value * 1.5))}><Plus /></Button>
      <Button size="xs" variant="outline" onClick={onBlank}><Plus />Add layer</Button>
    </div>
    <p id={instructionsId} className="sr-only">Drag clips to move them; drag an edge to trim. Clips move freely on every track. Hold Alt while dragging onto Main to reorder and close gaps. Arrow keys move overlay clips one frame; Shift moves one second. Alt and arrow keys reorder main clips. Delete removes a clip. On an edge, arrow keys trim. Escape cancels a drag.</p>
    <div ref={viewport} className="min-h-0 max-h-80 overflow-auto rounded-xl bg-black/25" aria-label="Video timeline" onDragStart={event => event.preventDefault()} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setExternalDrop(null); }}>
      <div className="relative" style={{ width: width + LABEL_WIDTH }}>
        <div className="sticky top-0 z-30 flex h-9 bg-card/95 backdrop-blur-md">
          <span className="sticky left-0 z-40 w-[76px] shrink-0 bg-card" />
          <div role="slider" tabIndex={0} aria-label="Current time" aria-valuemin={0} aria-valuemax={seconds} aria-valuenow={Math.min(currentSec, seconds)} aria-valuetext={timeLabel(currentSec)} className="relative h-9 shrink-0 cursor-crosshair touch-none focus-visible:outline-2 focus-visible:outline-ring" style={{ width }}
            onPointerDown={event => { if (event.button !== 0) return; event.currentTarget.setPointerCapture(event.pointerId); onSeek(Math.min(seconds, positionAt(event.clientX))); }}
            onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) onSeek(Math.min(seconds, positionAt(event.clientX))); }}
            onKeyDown={event => { if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return; event.preventDefault(); onSeek(event.key === "Home" ? 0 : event.key === "End" ? seconds : Math.max(0, Math.min(seconds, currentSec + (event.key === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? 1 : 1 / fps)))); }}>
            {ticks.map(t => <span key={t} aria-hidden style={{ left: t * scale }} className="pointer-events-none absolute inset-y-0 border-l border-white/15 pl-1 pt-1 text-[10px] tabular-nums text-muted-foreground">{timeLabel(t)}</span>)}
            <span aria-hidden className="pointer-events-none absolute bottom-0 h-3 w-3 -translate-x-1/2 rounded-t-sm bg-primary [clip-path:polygon(0_0,100%_0,100%_55%,50%_100%,0_55%)]" style={{ left: Math.min(currentSec, span) * scale }} />
          </div>
        </div>
        <div data-timeline-layer={newLayer} className={`flex h-8 ${ghost?.layer === newLayer || externalDrop?.layer === newLayer ? "bg-primary/10" : ""}`} {...dropHandlers(newLayer)}>
          <span className="sticky left-0 z-20 flex w-[76px] shrink-0 items-center justify-center bg-card text-muted-foreground"><Plus className="size-3" aria-hidden /></span>
          <div className="relative flex-1 border-b border-dashed border-white/10 px-2 pt-1 text-[11px] text-muted-foreground">Drop above to create a track
            {(ghost?.layer === newLayer || externalDrop?.layer === newLayer) && <span aria-hidden className="pointer-events-none absolute inset-y-0 w-0.5 bg-primary" style={{ left: (ghost?.layer === newLayer ? ghost.at : externalDrop?.at ?? 0) * scale }} />}
          </div>
        </div>
        {layers.map(layer => <div key={layer} data-timeline-layer={layer} className="flex border-b border-white/5" {...dropHandlers(layer)}>
          <span className="sticky left-0 z-20 flex w-[76px] shrink-0 items-center gap-1.5 bg-card px-2 text-[11px] text-muted-foreground">{layer === 0 ? <Film className="size-3.5" aria-hidden /> : <Layers className="size-3.5" aria-hidden />}{layer === 0 ? "Main" : `Track ${layer + 1}`}</span>
          <div className={`relative h-16 shrink-0 ${externalDrop?.layer === layer ? "bg-primary/5" : ""}`} style={{ width }}>
            {layout.items.filter(entry => (entry.item.layer ?? 0) === layer).map(({ item, from, duration }) => {
              const audio = !item.mediaId && item.clip.edits.length > 0 && item.clip.edits.every(edit => edit.type === "music" || edit.type === "sfx");
              const active = selectedId === item.id;
              const clipWidth = Math.max(40, duration / fps * scale);
              const moving = ghost?.id === item.id && ghost.kind !== "effect";
              return <div key={item.id} className={`group absolute top-2 h-12 rounded-md border ${active ? "z-10 border-primary ring-1 ring-primary" : "border-white/20"} ${audio ? "bg-emerald-950" : "bg-zinc-800"} ${moving ? "opacity-35" : ""}`} style={{ left: from / fps * scale, width: clipWidth }}>
                <button type="button" aria-label={`Select ${item.clip.title}, ${layer === 0 ? "main track" : `track ${layer + 1}`}`} aria-pressed={active} aria-describedby={instructionsId} className="absolute inset-0 cursor-grab touch-none overflow-hidden rounded-md text-left focus-visible:outline-2 focus-visible:outline-ring active:cursor-grabbing" onPointerDown={event => begin(event, item.id, "move")} {...sharedPointer}
                  onClick={() => { if (!suppressClick.current) { onSelect(item.id, from / fps); if (standalone(item)) onSelectEdit?.(0); } suppressClick.current = false; }}
                  onKeyDown={event => {
                    if (event.key === "Delete" || event.key === "Backspace") {
                      event.preventDefault();
                      const ops: EditorOperation[] = [{ type: "item.remove", sequenceId: sequence.id, itemId: item.id }];
                      const remaining = mainOthers(item.id);
                      if (layer === 0 && remaining.length) ops.push({ type: "item.reorder", sequenceId: sequence.id, itemId: remaining[0].item.id, layer: 0, index: 0 });
                      commit(ops, "Clip removed.");
                      return;
                    }
                    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                    const direction = event.key === "ArrowLeft" ? -1 : 1;
                    if (layer === 0 && event.altKey) {
                      event.preventDefault();
                      const ordered = layout.items.filter(entry => (entry.item.layer ?? 0) === 0).sort((a, b) => a.from - b.from);
                      const index = Math.max(0, Math.min(ordered.length - 1, ordered.findIndex(entry => entry.item.id === item.id) + direction));
                      commit([{ type: "item.reorder", sequenceId: sequence.id, itemId: item.id, layer: 0, index }], "Clip reordered.");
                    } else {
                      event.preventDefault(); commit(buildTimelineMove(sequence, item.id, Math.max(0, from / fps + direction * (event.shiftKey ? 1 : 1 / fps)), layer), "Clip moved.");
                    }
                  }}>
                  {item.mediaId && mediaUrls[item.mediaId] && <Filmstrip src={mediaUrls[item.mediaId]} start={item.clip.start} />}
                  {audio && <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-1 h-3 opacity-25" style={{ backgroundImage: "repeating-linear-gradient(90deg, currentColor 0 2px, transparent 2px 6px)" }} />}
                  <span className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/65 via-black/10 to-black/25" />
                  <span className="pointer-events-none relative flex items-center gap-1 px-3 py-1 text-[11px] font-medium text-white">{audio && <Music2 aria-hidden className="size-3 shrink-0" />}<span className="truncate">{standalone(item) ? effectLabel(item.clip.edits[0]) : item.clip.title}</span>{item.hidden && <EyeOff aria-label="Visuals hidden" className="size-3 shrink-0" />}{item.muted && <VolumeX aria-label="Audio muted" className="size-3 shrink-0" />}</span>
                </button>
                {(["start", "end"] as const).map(edge => <button key={edge} type="button" aria-label={`Trim ${edge} of ${item.clip.title}`} title={`Drag to trim ${edge}; arrow keys adjust one frame`} className={`absolute inset-y-0 z-20 w-3 cursor-ew-resize touch-none rounded-sm bg-primary/80 text-primary-foreground focus-visible:outline-2 focus-visible:outline-ring ${active ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"} ${edge === "start" ? "left-0" : "right-0"}`} onPointerDown={event => begin(event, item.id, edge)} {...sharedPointer} onClick={event => event.stopPropagation()} onKeyDown={event => {
                  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                  event.preventDefault();
                  try { commit(buildTimelineTrim(sequence, item.id, edge, (event.key === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? 1 : 1 / fps), media), "Clip trimmed."); } catch (error) { setNotice(error instanceof Error ? error.message : "Cannot trim further."); }
                }}><span aria-hidden className="mx-auto block h-5 w-px bg-current/80" /></button>)}
              </div>;
            })}
            {!sequence.items.length && layer === 0 && <span className="pointer-events-none absolute inset-2 flex items-center rounded-md border border-dashed border-white/20 px-3 text-xs text-muted-foreground">Drop videos here to start</span>}
            {ghost && ghost.layer === layer && ghost.kind !== "effect" && <div aria-hidden className={`pointer-events-none absolute top-1 z-30 h-14 rounded-md border-2 border-primary ${ghost.kind === "move" && ghost.index !== undefined ? "w-1 bg-primary" : "bg-primary/15"}`} style={{ left: ghost.at * scale, width: ghost.kind === "move" && ghost.index !== undefined ? 3 : Math.max(8, ghost.duration * scale) }}><span className="absolute left-1 top-0 whitespace-nowrap rounded bg-black/85 px-1 text-[10px] text-white">{ghost.kind === "move" && ghost.index !== undefined ? "Insert here" : timeLabel(ghost.at)}</span></div>}
            {externalDrop?.layer === layer && <div aria-hidden className="pointer-events-none absolute inset-y-1 z-30 w-0.5 bg-primary" style={{ left: externalDrop.at * scale }}><span className="absolute left-1 top-0 whitespace-nowrap rounded bg-black/85 px-1 text-[10px] text-white">{layer === 0 ? "Insert video" : "Add here"}</span></div>}
          </div>
        </div>)}
        {selected && selectedMap && effectTypes.map(type => <div key={type} className="flex border-b border-white/5">
          <span className="sticky left-0 z-20 flex w-[76px] shrink-0 items-center bg-card px-2 text-[10px] text-muted-foreground">{({ silence: "Cuts", punch: "Zoom", emphasis: "Emphasis", text: "Titles", image: "Images", music: "Music", sfx: "Sounds" })[type]}</span>
          <div className="relative h-8" style={{ width }}>
            {selected.item.clip.edits.map((edit, index) => {
              if (edit.type !== type) return null;
              const shift = ghost?.kind === "effect" && ghost.index === index ? ghost.delta : 0;
              const at = selected.from / fps + Math.max(0, srcToOut(selectedMap, edit.t) + shift);
              const duration = Math.max(1 / fps, srcToOut(selectedMap, edit.t + edit.d) - srcToOut(selectedMap, edit.t));
              return <button key={index} type="button" aria-label={`${effectLabel(edit)} effect`} aria-pressed={selectedEdit === index} title={`${effectLabel(edit)} · drag to move`} className={`absolute top-1 h-6 cursor-grab touch-none overflow-hidden rounded px-2 text-left text-[10px] focus-visible:outline-2 focus-visible:outline-ring active:cursor-grabbing ${selectedEdit === index ? "border border-primary bg-primary/30" : "border border-white/15 bg-white/10"}`} style={{ left: at * scale, width: Math.max(24, duration * scale) }} onPointerDown={event => begin(event, selected.item.id, "effect", index)} {...sharedPointer} onClick={() => { if (!suppressClick.current) onSelectEdit?.(index); suppressClick.current = false; }} onKeyDown={event => {
                if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                event.preventDefault(); moveEffect(sequence, selected.item.id, index, (event.key === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? 1 : 1 / fps));
              }}><span className="whitespace-nowrap">{effectLabel(edit)}</span></button>;
            })}
          </div>
        </div>)}
        <span aria-hidden className="pointer-events-none absolute bottom-0 top-9 z-10 w-px bg-primary" style={{ left: LABEL_WIDTH + Math.min(currentSec, span) * scale }} />
      </div>
    </div>
    <p className="text-[11px] text-muted-foreground">Drag to move between tracks. Alt-drag on Main to reorder.</p>
    <p className="sr-only" role="status">{notice}</p>
  </div>;
}
