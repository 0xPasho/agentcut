"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type ComponentProps, type PointerEvent } from "react";
import { EyeOff, Eye, VolumeX, Volume2, Play, Pause, Plus, Film, Music2, Layers, Magnet, Minus, Copy, Scissors, Trash2, ArrowUp, ArrowDown, MousePointerClick, MessageSquare, Blend, Timer } from "lucide-react";
import { Transition } from "@/lib/edl";
import type { Edit, MediaSource, VideoSequence } from "@/lib/edl";
import type { EditorOperation } from "@/lib/editor/operations";
import { buildTimelineGroupMove, buildTimelineMove, buildTimelineTrim, timelineCollides } from "@/lib/editor/timeline-interactions";
import { snapSpan, snapTargets, snapTime, type SnapPoint } from "@/lib/editor/snapping";
import { usePlayhead, usePlayheadSelector, usePlayheadStore } from "@/lib/editor/playhead";
import { cachedMediaPeaks, cachedPeaks, loadMediaPeaks, loadPeaks, thinPeaks } from "@/lib/editor/waveform";
import { cachedFrames, loadFrames } from "@/lib/editor/filmstrip";
import { activeDrag, classifyFile, dropDuration, hasFileDrag, hasMediaDrag, readDrag, type DragKind, type DragPayload } from "@/lib/editor/dnd";
import { sequenceFrames, transitionJoints } from "@/lib/sequences";
import { keyframeSummary } from "@/lib/editor/motion";
import { effectLabel, shotName, standaloneScene } from "@/lib/editor/canvas";
import { DEFAULT_TRANSITION_SEC, TRANSITION_DURATIONS, TRANSITION_KINDS, TRANSITION_LABELS, describeTransition } from "@/lib/editor/transitions";
import { buildTimeMap, srcToOut, type TimeMap } from "@/lib/timeline";
import { Button } from "./ui/button";
import { describeAuthor, isAgentAuthor } from "@/lib/editor/authorship";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuLabel, ContextMenuSeparator, ContextMenuTrigger, Menu, MenuContent, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "./ui/context-menu";

const LABEL_WIDTH = 76;
/* Everything below follows the playhead. They are separate components, and small ones,
   because each of them re-renders as the preview plays and the timeline around them
   must not. See src/lib/editor/playhead.ts. */

/** The running time, which only changes when the label itself does — ten times a second. */
function PlayheadLabel() {
  return <>{usePlayheadSelector(seconds => timeLabel(seconds))}</>;
}

/** The playhead's own mark: the handle in the ruler, and the line down the tracks. */
function PlayheadMark({ span, scale, offset = 0, className }: { span: number; scale: number; offset?: number; className: string }) {
  const left = usePlayheadSelector(seconds => offset + Math.min(seconds, span) * scale);
  return <span aria-hidden className={className} style={{ left }} />;
}

/** The ruler is a slider, so its value has to follow the playhead for a screen reader too. */
function Ruler({ max, children, ...rest }: { max: number } & ComponentProps<"div">) {
  const seconds = usePlayhead();
  return <div role="slider" tabIndex={0} aria-label="Current time" aria-valuemin={0} aria-valuemax={max}
    aria-valuenow={Math.min(seconds, max)} aria-valuetext={timeLabel(seconds)} {...rest}>{children}</div>;
}

/** Splitting needs the playhead inside the clip, and the menu opens long after the last render. */
function SplitItem({ from, until, onSplit }: { from: number; until: number; onSplit: () => void }) {
  const inside = usePlayheadSelector(seconds => seconds > from + .02 && seconds < until - .02);
  return <ContextMenuItem shortcut="S" disabled={!inside} onClick={onSplit}><Scissors />Split at playhead</ContextMenuItem>;
}

/**
 * The joint between two shots on one track.
 *
 * It sits on the seam itself, because that is the thing being changed: the marker
 * hangs over the top of the two blocks and, once a transition is set, the overlap it
 * costs is drawn across both of them so the time it takes is visible rather than
 * implied. With nothing set the marker only appears when the track is under the
 * pointer or the keyboard — an empty joint is not news, and one of these between
 * every pair of shots would be.
 */
function TransitionJointControl({ left, width, current, title, previousTitle, maxSeconds, onSet }: {
  left: number; width: number; current: Transition | null; title: string; previousTitle: string;
  maxSeconds: number; onSet: (transition: Transition | null) => void;
}) {
  const between = `from “${previousTitle}” into “${title}”`;
  const label = current ? `${describeTransition(current)} ${between}` : `Add a transition ${between}`;
  const held = Math.min(current?.durationSec ?? DEFAULT_TRANSITION_SEC, maxSeconds);
  // Changing one field keeps the rest, including who placed it: editing a template's
  // transition leaves it the template's, exactly as editing one of its titles does.
  const set = (patch: Partial<Transition>) => onSet(Transition.parse({ ...(current ?? {}), durationSec: held, ...patch }));
  return <>
    {current && width > 0 && <span aria-hidden className="pointer-events-none absolute top-2 z-20 h-12 rounded-[4px] bg-primary/20 ring-1 ring-inset ring-primary/60" style={{ left, width }} />}
    <Menu>
      {/* 16px of ink, because the seam it marks is a line; 32×24 of target, because a
          control has to be hittable. The extra reaches up into the gap above the track,
          where nothing else is, rather than down over the trim handle beside it. */}
      <MenuTrigger render={<button type="button" title={label} aria-label={label}
        className={`absolute top-0 z-30 flex size-4 -translate-x-1/2 items-center justify-center rounded-md border transition-[opacity,color,background-color,border-color] duration-150 ease-out motion-reduce:transition-none after:absolute after:-inset-x-2 after:-top-2 after:bottom-0 after:content-[''] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring ${current
          ? "border-primary/70 bg-primary text-primary-foreground"
          : "border-white/25 bg-zinc-900 text-muted-foreground opacity-0 hover:border-white/60 hover:text-foreground focus-visible:opacity-100 group-hover/track:opacity-100 aria-expanded:opacity-100"}`}
        style={{ left: left + width / 2 }} />}>
        <Blend className="size-2.5" aria-hidden />
      </MenuTrigger>
      <MenuContent>
        <ContextMenuLabel>{current ? describeTransition(current) : "No transition"} · {between}</ContextMenuLabel>
        {/* Which kind and which length are on now is said by the platform, not by a colour. */}
        <MenuRadioGroup value={current?.kind ?? ""} onValueChange={value => set({ kind: value as Transition["kind"] })}>
          {TRANSITION_KINDS.map(kind => <MenuRadioItem key={kind} value={kind}>
            <Blend className="text-muted-foreground" />{TRANSITION_LABELS[kind]}
          </MenuRadioItem>)}
        </MenuRadioGroup>
        <ContextMenuSeparator />
        <MenuRadioGroup value={current ? TRANSITION_DURATIONS.find(value => Math.abs(held - value) < 1e-6) ?? null : null} onValueChange={value => set({ durationSec: Number(value) })}>
          {TRANSITION_DURATIONS.map(value => <MenuRadioItem key={value} value={value} disabled={value > maxSeconds + 1e-6}>
            <Timer className="text-muted-foreground" />{value}s
          </MenuRadioItem>)}
        </MenuRadioGroup>
        <ContextMenuSeparator />
        <ContextMenuItem disabled={!current} onClick={() => onSet(null)}><Trash2 />Remove the transition</ContextMenuItem>
      </MenuContent>
    </Menu>
  </>;
}

const NO_MORE_FOOTAGE = "This clip has no more footage that way.";
const EMPTY_MEDIA: MediaSource[] = [];
type Drag = { id: string; kind: "move" | "start" | "end" | "effect" | "effect-start" | "effect-end"; x: number; y: number; at: number; duration: number; layer: number; index?: number; moved: boolean; snapshot: VideoSequence; scrollLeft: number };
type Ghost = { id: string; at: number; duration: number; layer: number; index?: number; delta: number; kind: Drag["kind"]; guide?: SnapPoint | null; shift?: number; lift?: number };
type ExternalDrop = { layer: number; at: number; guide: SnapPoint | null; payload: DragPayload | null; files: boolean; replace?: { itemId: string; at: number; duration: number } };
type Props = {
  /** Whose media the peaks belong to: a shot's own audio is drawn from the host's copy of it. */
  projectId: string;
  sequence: VideoSequence; selectedId?: string; dispatch: (ops: EditorOperation[]) => boolean | void;
  onSelect: (id: string, seconds: number) => void; onBlank: () => void;
  onSeek: (seconds: number) => void;
  /** Transport lives here because the preview has no controls of its own. */
  playing?: boolean; onPlayToggle?: () => void;
  mediaUrls?: Record<string, string>; media?: MediaSource[];
  /** Asset files by id, so a sound can show what it actually sounds like. */
  assetUrls?: Record<string, string>;
  selectedEdit?: number | null; onSelectEdit?: (index: number) => void;
  onDropMedia?: (mediaId: string, at: number, layer: number) => void;
  onDropAsset?: (assetId: string, at: number, layer: number) => void;
  onDropFiles?: (files: File[], at: number, layer: number) => void;
  /** A file chosen in the folder browser: imported by the host, then placed here. */
  onDropLocalFile?: (file: string, kind: DragKind, at: number, layer: number) => void;
  /** An online search result: adopted by the host, then placed here. */
  onDropSearchHit?: (hit: NonNullable<DragPayload["search"]>, at: number, layer: number) => void;
  onReplaceMedia?: (itemId: string, mediaId: string) => void;
  onReplaceAsset?: (itemId: string, assetId: string, editIndex?: number) => void;
  onSplit?: (itemId: string) => void;
  onDuplicate?: (itemId: string) => void;
  /** Lift a shot's own sound onto its own track, so it can be moved, trimmed and levelled alone. */
  onDetachAudio?: (itemId: string) => void;
  /** Open the conversation about this clip: "shorter", "move it", "why is this here". */
  onAskAgent?: (itemId: string) => void;
  /** Feedback that deserves to be seen, not only announced: an undoable change or a refusal. */
  onNotify?: (message: string, kind: "change" | "error") => void;
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

/** Frames sampled across what the clip shows, so the strip changes with the footage. */
const STRIP_FRAMES = 5;
function Filmstrip({ src, start, end }: { src: string; start: number; end: number }) {
  const [frames, setFrames] = useState<string[] | null | undefined>(() => cachedFrames(src, start, end, STRIP_FRAMES));
  useEffect(() => setFrames(cachedFrames(src, start, end, STRIP_FRAMES)), [src, start, end]);
  useEffect(() => {
    if (frames !== undefined) return;
    let disposed = false;
    void loadFrames(src, start, end, STRIP_FRAMES).then(result => { if (!disposed) setFrames(result); });
    return () => { disposed = true; };
  }, [src, start, end, frames]);
  if (!frames?.length) return null;
  return <span aria-hidden className="pointer-events-none absolute inset-0 flex overflow-hidden rounded-md opacity-55">
    {frames.map((frame, index) => <span key={index} className="min-w-0 flex-1 bg-cover bg-center" style={{ backgroundImage: `url(${frame})` }} />)}
  </span>;
}

/** One drawn envelope, mirrored around the middle and stretched to whatever width it has. */
function WaveShape({ peaks, className }: { peaks: number[]; className: string }) {
  const shown = thinPeaks(peaks);
  if (shown.length < 2) return null;
  const points = shown.map((peak, index) => `${(index / (shown.length - 1) * 100).toFixed(2)},${(50 - peak * 46).toFixed(2)}`).join(" ")
    + " " + shown.map((peak, index) => `${((shown.length - 1 - index) / (shown.length - 1) * 100).toFixed(2)},${(50 + shown[shown.length - 1 - index] * 46).toFixed(2)}`).join(" ");
  return <svg aria-hidden viewBox="0 0 100 100" preserveAspectRatio="none" className={className}>
    <polygon points={points} />
  </svg>;
}

/**
 * A shot's own audio, drawn inside the shot. The peaks are computed on this machine and
 * sliced to the part of the file the shot actually uses, so trimming redraws it.
 */
function SourceWaveform({ projectId, mediaId, start, end, strong }: { projectId: string; mediaId: string; start: number; end: number; strong: boolean }) {
  const [data, setData] = useState(() => cachedMediaPeaks(projectId, mediaId));
  useEffect(() => setData(cachedMediaPeaks(projectId, mediaId)), [projectId, mediaId]);
  useEffect(() => {
    if (data !== undefined) return;
    let disposed = false;
    void loadMediaPeaks(projectId, mediaId).then(result => { if (!disposed) setData(result); });
    return () => { disposed = true; };
  }, [projectId, mediaId, data]);
  if (!data?.peaks.length) return null;
  const from = Math.max(0, Math.round(start * data.rate));
  const slice = data.peaks.slice(from, Math.max(from + 2, Math.round(end * data.rate)));
  if (slice.length < 2) return null;
  return <WaveShape peaks={slice} className={`pointer-events-none absolute inset-x-0 ${strong ? "inset-y-0 h-full fill-emerald-300/60" : "bottom-0 h-6 fill-white/45"}`} />;
}

/** The real shape of a sound, decoded once per file and drawn to fit whatever width it has. */
function Waveform({ src }: { src: string }) {
  const [peaks, setPeaks] = useState<number[] | null | undefined>(() => cachedPeaks(src));
  useEffect(() => {
    if (peaks !== undefined) return;
    let disposed = false;
    void loadPeaks(src).then(result => { if (!disposed) setPeaks(result); });
    return () => { disposed = true; };
  }, [src, peaks]);
  useEffect(() => setPeaks(cachedPeaks(src)), [src]);
  if (!peaks?.length) return null;
  return <WaveShape peaks={peaks} className="pointer-events-none absolute inset-x-0 bottom-0 h-7 w-full fill-emerald-300/70 opacity-60" />;
}

export function SequenceTimeline({ projectId, sequence, selectedId, dispatch, onSelect, onBlank, onSeek, mediaUrls = {}, assetUrls = {}, media = EMPTY_MEDIA, selectedEdit, onSelectEdit, onDropMedia, onDropAsset, onDropFiles, onDropLocalFile, onDropSearchHit, onReplaceMedia, onReplaceAsset, onSplit, onDuplicate, onDetachAudio, onAskAgent, onNotify, playing = false, onPlayToggle }: Props) {
  // Reading the playhead here never re-renders the timeline; the parts that draw it
  // subscribe on their own, so a playing preview repaints a marker, not every clip.
  const playhead = usePlayheadStore();
  const viewport = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const ghostRef = useRef<Ghost | null>(null);
  const suppressClick = useRef(false);
  const [availableWidth, setAvailableWidth] = useState(640);
  const [zoom, setZoom] = useState(1);
  const [extraWidth, setExtraWidth] = useState(0);
  const pointer = useRef<{clientX:number;clientY:number;altKey:boolean;metaKey:boolean;ctrlKey:boolean}|null>(null);
  const hovering = useRef<{ clientX: number; metaKey: boolean; ctrlKey: boolean; layer: number; payload: DragPayload | null; files: boolean } | null>(null);
  const dragScroll = useRef<number|null>(null);
  const dragTick = useRef<()=>void>(()=>{});
  const stopDragScroll = () => { if (dragScroll.current !== null) cancelAnimationFrame(dragScroll.current); dragScroll.current = null; hovering.current = null; };
  const animation = useRef<number|null>(null);
  const tick = useRef<()=>void>(()=>{});
  const stopScroll = () => { if(animation.current!==null)cancelAnimationFrame(animation.current);animation.current=null;pointer.current=null; };
  useEffect(()=>()=>{if(animation.current!==null)cancelAnimationFrame(animation.current);if(dragScroll.current!==null)cancelAnimationFrame(dragScroll.current);},[]);
  useEffect(()=>setExtraWidth(0),[sequence,zoom]);
  useEffect(()=>setExtra([]),[sequence.id]);
  const [ghost, setGhostState] = useState<Ghost | null>(null);
  const [externalDrop, setExternalDrop] = useState<ExternalDrop | null>(null);
  const [snapping, setSnapping] = useState(true);
  const [scrubGuide, setScrubGuide] = useState<SnapPoint | null>(null);
  // Multi-selection is a view concept: it never reaches the project, only the next transaction.
  const [extra, setExtra] = useState<string[]>([]);
  const group = useRef<{ id: string; at: number; layer: number; duration: number }[]>([]);
  const [effectDrop, setEffectDrop] = useState<number | null>(null);
  // Zooming keeps the moment under the pointer still, so the timeline grows around what you are looking at.
  const geometry = useRef({ scale: 1, fps: 30 });
  const anchor = useRef<{ time: number; clientX: number } | null>(null);
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const marqueeRef = useRef<typeof marquee>(null);
  const [notice, setNotice] = useState("");
  const instructionsId = useId();
  const setGhost = (value: Ghost | null) => { ghostRef.current = value; setGhostState(value); };
  const cancelDrag = () => { stopScroll(); drag.current = null; group.current = []; setGhost(null); };
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setAvailableWidth(Math.max(200, entry.contentRect.width - LABEL_WIDTH)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const cancel = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Dismissing a dialog or menu is not a request to deselect clips; anywhere else, Escape
      // still gives up the selection.
      const elsewhere = event.target instanceof HTMLElement && event.target.closest('[role="dialog"],[role="menu"]');
      if (!drag.current && elsewhere) return;
      stopScroll();
      if (drag.current) suppressClick.current = true; else setExtra([]);
      // A cancelled drag must not leave its travelling group behind for the next one to snap around.
      drag.current = null; group.current = []; ghostRef.current = null; setGhostState(null); stopDragScroll(); setExternalDrop(null);
    };
    window.addEventListener("keydown", cancel);
    return () => window.removeEventListener("keydown", cancel);
  }, []);

  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      // A trackpad pinch arrives as ctrl + wheel; Command + wheel is the mouse equivalent.
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        const { scale: current, fps: rate } = geometry.current;
        const time = Math.max(0, Math.round((event.clientX - el.getBoundingClientRect().left + el.scrollLeft - LABEL_WIDTH) / current * rate) / rate);
        setZoom(value => {
          const next = Math.min(12, Math.max(1, value * Math.exp(-event.deltaY * 0.002)));
          if (next !== value) anchor.current = { time, clientX: event.clientX };
          return next;
        });
        return;
      }
      // A wheel mouse has no horizontal axis; Shift gives it one.
      if (event.shiftKey && event.deltaY && !event.deltaX) { event.preventDefault(); el.scrollLeft += event.deltaY; }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const layout = sequenceFrames(sequence);
  const joints = transitionJoints(sequence);
  const fps = sequence.output.fps;
  const seconds = sequence.items.length ? layout.duration / fps : 10;
  const baseSpan = Math.max(seconds + Math.min(seconds * .08, 3), 5);
  const baseWidth = Math.max(availableWidth, 480) * zoom;
  const scale = baseWidth / baseSpan;
  const width = baseWidth + extraWidth;
  const span = width / scale;
  const layers = [...new Set([0, ...sequence.items.map(item => item.layer ?? 0)])].sort((a, b) => b - a);
  const newLayer = Math.max(...layers) + 1;
  const alive = (id: string) => sequence.items.some(item => item.id === id);
  const selection = new Set([...(selectedId ? [selectedId] : []), ...extra].filter(alive));
  const selected = layout.items.find(({ item }) => item.id === selectedId);
  const selectedMap = selected ? buildTimeMap(selected.item.clip) : null;
  const effectTypes = [...new Set(selected && !standaloneScene(selected.item) ? selected.item.clip.edits.map(edit => edit.type) : [])];
  const roundFrame = (value: number) => Math.round(value * fps) / fps;
  geometry.current = { scale, fps };
  useLayoutEffect(() => {
    const held = anchor.current, el = viewport.current;
    if (!held || !el) return;
    anchor.current = null;
    el.scrollLeft = Math.max(0, held.time * scale + LABEL_WIDTH - (held.clientX - el.getBoundingClientRect().left));
  }, [zoom, scale]);
  // Frequent, self-evident gestures stay quiet and only announce themselves; changes that are
  // easy to miss or hard to reverse ask for a visible confirmation with a way back.
  const announce = (message: string, kind: "change" | "error", loud: boolean) => {
    if (loud && onNotify) onNotify(message, kind); else setNotice(message);
  };
  /**
   * The editor reports a refused edit rather than throwing, so success has to be checked. An
   * edit that did not apply must never claim it did — its toast would offer an Undo that pops
   * somebody else's inverse off the stack.
   */
  const commit = (ops: EditorOperation[], message: string, loud = false) => {
    if (!ops.length) return;
    if (dispatch(ops) === false) {
      if (loud) announce("That edit could not be applied. The project may have changed since you started.", "error", true);
      return;
    }
    announce(message, "change", loud);
  };
  const positionAt = (clientX: number) => {
    const el = viewport.current;
    return Math.max(0, roundFrame((clientX - (el?.getBoundingClientRect().left ?? 0) + (el?.scrollLeft ?? 0) - LABEL_WIDTH) / scale));
  };
  /** A plain click anywhere on the timeline parks the playhead there; only a drag does more. */
  const seekAt = (clientX: number) => onSeek(Math.max(0, Math.min(seconds, positionAt(clientX))));
  // A snap is an affordance, never a hidden edit: the magnet can be turned off, and
  // holding Command or Control inverts it for one drag without leaving the gesture.
  const tolerance = 9 / scale;
  const magnet = (event: { metaKey?: boolean; ctrlKey?: boolean }) => snapping !== !!(event.metaKey || event.ctrlKey);
  const targets = (excludeId?: string, withPlayhead = true) => {
    const points = snapTargets(sequence, { excludeId, playheadSec: withPlayhead ? playhead.get() : undefined });
    if (group.current.length < 2) return points;
    // A selection should never snap to the clips travelling with it.
    const moving = new Set(group.current.map(entry => entry.id));
    const edges = new Set(layout.items.filter(entry => moving.has(entry.item.id))
      .flatMap(entry => [(entry.from / fps).toFixed(4), ((entry.from + entry.duration) / fps).toFixed(4)]));
    return points.filter(point => point.kind !== "edge" || !edges.has(point.at.toFixed(4)));
  };
  // The preview follows the edge being trimmed, so the frame you are cutting to is on screen.
  // That moves the playhead with the edge, which is why a trim never snaps to it.
  const lastPreview = useRef(0);
  const previewEdge = (seconds: number) => {
    const now = performance.now();
    if (now - lastPreview.current < 60) return;
    lastPreview.current = now;
    onSeek(Math.max(0, seconds));
  };
  const pullSpan = (at: number, duration: number, event: { metaKey?: boolean; ctrlKey?: boolean }, excludeId?: string) =>
    magnet(event) ? snapSpan(at, duration, targets(excludeId), tolerance) : { at, guide: null };
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
  /** Removing from Main closes the gap it leaves; an overlay keeps every other item where it is. */
  const removeItems = (ids: string[]) => {
    const removing = new Set(ids);
    const ops: EditorOperation[] = ids.map(id => ({ type: "item.remove", sequenceId: sequence.id, itemId: id }));
    const tookFromMain = layout.items.some(entry => removing.has(entry.item.id) && (entry.item.layer ?? 0) === 0);
    const remaining = layout.items.filter(entry => !removing.has(entry.item.id) && (entry.item.layer ?? 0) === 0).sort((a, b) => a.from - b.from);
    // Closing the gap re-packs the whole track, which would throw away times the author set by
    // hand. Only a track that is still following on its own gets packed up behind a removal.
    const packed = remaining.every(entry => entry.item.at == null);
    if (tookFromMain && remaining.length && packed) ops.push({ type: "item.reorder", sequenceId: sequence.id, itemId: remaining[0].item.id, layer: 0, index: 0 });
    commit(ops, ids.length > 1 ? `${ids.length} clips removed.` : "Removed from the timeline.", true);
    setExtra([]);
  };
  /**
   * Dragging across empty track space sweeps up everything it touches, the way selecting
   * files in a folder does. Releasing without moving just drops the extra selection.
   */
  const marqueeHandlers = {
    onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 || event.target !== event.currentTarget) return;
      try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* the pointer ended before this handler ran */ }
      const box = { x0: event.clientX, y0: event.clientY, x1: event.clientX, y1: event.clientY };
      marqueeRef.current = box; setMarquee(box);
    },
    onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
      const box = marqueeRef.current;
      if (!box) return;
      const next = { ...box, x1: event.clientX, y1: event.clientY };
      marqueeRef.current = next; setMarquee(next);
    },
    onPointerUp: (event: PointerEvent<HTMLDivElement>) => {
      const box = marqueeRef.current;
      marqueeRef.current = null; setMarquee(null);
      if (!box) return;
      if (Math.abs(box.x1 - box.x0) < 4 && Math.abs(box.y1 - box.y0) < 4) { setExtra([]); seekAt(box.x0); return; }
      const from = Math.min(positionAt(box.x0), positionAt(box.x1)), to = Math.max(positionAt(box.x0), positionAt(box.x1));
      const top = Math.min(box.y0, box.y1), bottom = Math.max(box.y0, box.y1);
      const rows = [...(viewport.current?.querySelectorAll<HTMLElement>("[data-timeline-layer]") ?? [])];
      const layers = new Set(rows.filter(row => { const rect = row.getBoundingClientRect(); return rect.bottom >= top && rect.top <= bottom; }).map(row => Number(row.dataset.timelineLayer)));
      const caught = layout.items.filter(entry => layers.has(entry.item.layer ?? 0) && entry.from / fps < to && (entry.from + entry.duration) / fps > from)
        .sort((a, b) => a.from - b.from);
      if (!caught.length) return setExtra([]);
      const [first, ...rest] = caught;
      setExtra(rest.map(entry => entry.item.id));
      onSelect(first.item.id, first.from / fps);
      event.preventDefault();
    },
    onPointerCancel: () => { marqueeRef.current = null; setMarquee(null); },
  };
  /**
   * Tracks stack, so their order is an edit. Swapping two of them is an ordinary group move:
   * every clip on both keeps the time it resolved to and only changes which track it is on.
   */
  const overlayLayers = layers.filter(value => value !== 0);
  const swapTracks = (a: number, b: number) => {
    const moves = layout.items.filter(entry => [a, b].includes(entry.item.layer ?? 0))
      .map(entry => ({ itemId: entry.item.id, at: entry.from / fps, layer: (entry.item.layer ?? 0) === a ? b : a }));
    commit(buildTimelineGroupMove(sequence, moves), "Tracks reordered.");
  };
  const selectTrack = (layer: number) => {
    const caught = layout.items.filter(entry => (entry.item.layer ?? 0) === layer).sort((a, b) => a.from - b.from);
    if (!caught.length) return;
    const [first, ...rest] = caught;
    setExtra(rest.map(entry => entry.item.id));
    onSelect(first.item.id, first.from / fps);
  };
  /** Delete acts on the whole selection when the clip you pressed it on belongs to one. */
  const removeFrom = (id: string) => removeItems(selection.has(id) && selection.size > 1 ? [...selection] : [id]);
  const toggleSelection = (id: string) => {
    if (id !== selectedId) return setExtra(previous => previous.includes(id) ? previous.filter(value => value !== id) : [...previous, id]);
    const [next, ...rest] = extra.filter(alive);
    if (!next) return;
    setExtra(rest);
    onSelect(next, (layout.items.find(entry => entry.item.id === next)?.from ?? 0) / fps);
  };
  const begin = (event: PointerEvent<HTMLElement>, id: string, kind: Drag["kind"], index?: number) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.focus({ preventScroll: true });
    const entry = layout.items.find(({ item }) => item.id === id);
    if (!entry) return;
    suppressClick.current = false;
    group.current = kind === "move" && selection.size > 1 && selection.has(id)
      ? layout.items.filter(candidate => selection.has(candidate.item.id))
        .map(candidate => ({ id: candidate.item.id, at: candidate.from / fps, layer: candidate.item.layer ?? 0, duration: candidate.duration / fps }))
      : [];
    drag.current = { id, kind, x: event.clientX, y: event.clientY, at: entry.from / fps, duration: entry.duration / fps, layer: entry.item.layer ?? 0, index, moved: false, snapshot: sequence, scrollLeft: viewport.current?.scrollLeft ?? 0 };
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* the pointer ended before this handler ran; the window listeners still finish the drag */ }
    pointer.current={clientX:event.clientX,clientY:event.clientY,altKey:event.altKey,metaKey:event.metaKey,ctrlKey:event.ctrlKey};
    if(animation.current===null)animation.current=requestAnimationFrame(()=>tick.current());
  };
  const updateDrag = (event: {clientX:number;clientY:number;altKey:boolean;metaKey:boolean;ctrlKey:boolean}) => {
    const d = drag.current;
    if (!d) return;
    if (!d.moved && Math.hypot(event.clientX - d.x, event.clientY - d.y) < 4) return;
    d.moved = true;
    const delta = roundFrame((event.clientX - d.x + (viewport.current?.scrollLeft ?? 0) - d.scrollLeft) / scale);
    if (d.kind === "move") {
      const layer = layerAt(event.clientY, d.layer);
      const pull = pullSpan(Math.max(0, roundFrame(d.at + delta)), d.duration, event, d.id);
      const target = layer === 0 && event.altKey && group.current.length < 2
        ? { ...insertion(d.id, positionAt(event.clientX)), guide: null }
        : { at: Math.max(0, roundFrame(pull.at)), index: undefined, guide: pull.guide };
      setGhost({ id: d.id, kind: d.kind, duration: d.duration, layer, ...target, delta, shift: target.at - d.at, lift: layer - d.layer });
    } else if (d.kind === "effect" || d.kind === "effect-start" || d.kind === "effect-end") {
      setGhost({ id: d.id, kind: d.kind, duration: d.duration, layer: d.layer, at: d.at, index: d.index, delta });
    } else {
      try {
        // Only the edge that actually moves in output time can snap: trimming the head of a
        // packed main clip ripples the rest instead of moving the clip itself.
        const anchor = d.kind === "end" ? d.at + d.duration : d.at;
        const free = d.kind === "end" || d.layer !== 0;
        const pull = free && magnet(event) ? snapTime(anchor + delta, targets(d.id, false), tolerance) : { at: anchor + delta, guide: null };
        const trimDelta = roundFrame(pull.at - anchor);
        const ops = buildTimelineTrim(d.snapshot, d.id, d.kind, trimDelta, media);
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
        setGhost({ id: d.id, kind: d.kind, at, duration, layer: d.layer, delta: trimDelta, guide: pull.guide });
        previewEdge(d.kind === "end" ? at + duration - 1 / fps : at);
      } catch (error) { setNotice(error instanceof Error ? error.message : NO_MORE_FOOTAGE); }
    }
  };
  const move = (event: PointerEvent<HTMLElement>) => {
    pointer.current={clientX:event.clientX,clientY:event.clientY,altKey:event.altKey,metaKey:event.metaKey,ctrlKey:event.ctrlKey};
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
      if(speed>0 && el.scrollLeft+el.clientWidth>=el.scrollWidth-20 && (d.kind==="end"||d.kind==="move"))setExtraWidth(value=>Math.min(value+120, baseWidth*4));
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
  /**
   * Dragging an effect's edge changes how long it runs, in the clip's own source time. The
   * opposite edge stays put, and it can never grow past the clip that carries it.
   */
  const resizeEffect = (snapshot: VideoSequence, id: string, index: number, edge: "start" | "end", delta: number) => {
    const entry = snapshot.items.find(item => item.id === id);
    const edit = entry?.clip.edits[index];
    if (!entry || !edit) return;
    const map = buildTimeMap(entry.clip);
    const span = entry.clip.end - entry.clip.start, minimum = 1 / fps;
    const moving = edge === "start" ? srcToOut(map, edit.t) : srcToOut(map, edit.t + edit.d);
    const landed = sourceAt(map, Math.max(0, Math.min(map.duration, moving + delta)));
    const next = edge === "start"
      ? (() => { const t = Math.max(0, Math.min(edit.t + edit.d - minimum, landed)); return { t, d: edit.t + edit.d - t }; })()
      : { t: edit.t, d: Math.max(minimum, Math.min(span - edit.t, landed - edit.t)) };
    if (Math.abs(next.t - edit.t) < 1e-6 && Math.abs(next.d - edit.d) < 1e-6) return;
    const edits = entry.clip.edits.map((value, i) => i === index ? { ...value, ...next } : value);
    commit([{ type: "item.patch", sequenceId: sequence.id, itemId: id, patch: { edits }, before: { edits: entry.clip.edits } }], "Effect resized.");
  };
  const end = () => {
    const d = drag.current, g = ghostRef.current;
    if (d) suppressClick.current = d.moved;
    if (d?.moved && g) {
      if (d.kind === "move") {
        const travelling = group.current;
        if (g.layer === 0 && g.index !== undefined) commit([{ type: "item.reorder", sequenceId: sequence.id, itemId: d.id, layer: 0, index: g.index }], "Clip reordered.");
        else if (travelling.length > 1) {
          const shift = g.at - d.at, lift = g.layer - d.layer;
          commit(buildTimelineGroupMove(d.snapshot, travelling.map(entry => ({
            itemId: entry.id, at: Math.max(0, roundFrame(entry.at + shift)), layer: Math.max(0, entry.layer + lift),
          }))), `${travelling.length} clips moved.`);
        }
        else commit(buildTimelineMove(d.snapshot, d.id, g.at, g.layer), "Clip moved.");
        onSelect(d.id, g.at);
      } else if (d.kind === "effect") moveEffect(d.snapshot, d.id, d.index!, g.delta);
      else if (d.kind === "effect-start" || d.kind === "effect-end") resizeEffect(d.snapshot, d.id, d.index!, d.kind === "effect-start" ? "start" : "end", g.delta);
      else {
        try { commit(buildTimelineTrim(d.snapshot, d.id, d.kind, g.delta, media), "Clip trimmed."); }
        catch (error) { setNotice(error instanceof Error ? error.message : NO_MORE_FOOTAGE); }
      }
    }
    cancelDrag();
  };
  /**
   * Dropping onto the body of a compatible clip swaps its footage in place and keeps the
   * slot; the outer fifth of a clip still inserts, so a drop near a cut is never a surprise.
   */
  const replaceTarget = (layer: number, at: number, payload: DragPayload | null) => {
    if (!payload || payload.file || payload.search) return undefined;
    // Later items paint over earlier ones on the same track, so the last match is what was aimed at.
    const hit = layout.items.findLast(entry => (entry.item.layer ?? 0) === layer && at >= entry.from / fps && at <= (entry.from + entry.duration) / fps);
    if (!hit || hit.duration <= 0) return undefined;
    const position = (at - hit.from / fps) / (hit.duration / fps);
    if (position < .2 || position > .8) return undefined;
    const edits = hit.item.clip.edits, standaloneEdit = hit.item.mediaId === null && edits.length === 1 ? edits[0] : null;
    const compatible = payload.kind === "video" ? hit.item.mediaId !== null && !!onReplaceMedia
      : !!onReplaceAsset && !!standaloneEdit && (payload.kind === "image" ? standaloneEdit.type === "image" : standaloneEdit.type === "music" || standaloneEdit.type === "sfx");
    return compatible ? { itemId: hit.item.id, at: hit.from / fps, duration: hit.duration / fps } : undefined;
  };
  /** Where an incoming asset or desktop file would land on this track, already snapped. */
  const resolveDrop = (hover: { clientX: number; metaKey: boolean; ctrlKey: boolean; layer: number; payload: DragPayload | null; files: boolean }): ExternalDrop => {
    const duration = hover.payload ? dropDuration(hover.payload) : 0;
    const raw = positionAt(hover.clientX);
    const replace = replaceTarget(hover.layer, raw, hover.payload);
    if (replace) return { layer: hover.layer, at: replace.at, guide: null, payload: hover.payload, files: false, replace };
    const pull = !magnet(hover) ? { at: raw, guide: null }
      : duration ? snapSpan(raw, duration, targets(), tolerance) : snapTime(raw, targets(), tolerance);
    return { layer: hover.layer, at: Math.max(0, roundFrame(pull.at)), guide: pull.guide, payload: hover.payload, files: hover.files };
  };
  const dropTarget = (event: React.DragEvent<HTMLDivElement>, layer: number) => {
    const types = Array.from(event.dataTransfer.types);
    const media = hasMediaDrag(types), files = hasFileDrag(types) && !!onDropFiles;
    if (!media && !files) return null;
    if (media && !onDropMedia && !onDropAsset) return null;
    return { clientX: event.clientX, metaKey: event.metaKey, ctrlKey: event.ctrlKey, layer, payload: media ? activeDrag() : null, files: files && !media };
  };
  // A dragover only fires while the pointer moves, so holding still at the edge needs its own loop.
  dragTick.current = () => {
    const el = viewport.current, hover = hovering.current;
    if (!el || !hover) { dragScroll.current = null; return; }
    const rect = el.getBoundingClientRect();
    const right = Math.max(0, Math.min(1, (hover.clientX - (rect.right - 56)) / 56));
    const left = Math.max(0, Math.min(1, (rect.left + LABEL_WIDTH + 56 - hover.clientX) / 56));
    const speed = (right - left) * 14;
    if (speed) {
      if (speed > 0 && el.scrollLeft + el.clientWidth >= el.scrollWidth - 20) setExtraWidth(value => Math.min(value + 80, baseWidth * 4));
      el.scrollLeft += speed;
      setExternalDrop(resolveDrop(hover));
    }
    dragScroll.current = requestAnimationFrame(() => dragTick.current());
  };
  const dropHandlers = (layer: number) => ({
    onDragOver: (event: React.DragEvent<HTMLDivElement>) => {
      const target = dropTarget(event, layer);
      if (!target) return;
      event.preventDefault(); event.dataTransfer.dropEffect = "copy";
      hovering.current = target;
      if (dragScroll.current === null) dragScroll.current = requestAnimationFrame(() => dragTick.current());
      setExternalDrop(resolveDrop(target));
    },
    onDrop: (event: React.DragEvent<HTMLDivElement>) => {
      const hover = dropTarget(event, layer);
      if (!hover) return;
      event.preventDefault();
      const target = resolveDrop(hover);
      stopDragScroll();
      setExternalDrop(null);
      if (target.files) {
        const files = Array.from(event.dataTransfer.files).filter(file => classifyFile(file.name));
        if (!files.length) return announce("Those files are not video, image or audio.", "error", true);
        onDropFiles?.(files, target.at, layer);
        return setNotice(`Importing ${files.length === 1 ? files[0].name : `${files.length} files`}…`);
      }
      const payload = readDrag(event.dataTransfer);
      if (!payload) return announce("This asset could not be added.", "error", true);
      if (target.replace) {
        // The owner of the replacement reports it, so a drop never announces it twice.
        if (payload.mediaId) onReplaceMedia?.(target.replace.itemId, payload.mediaId);
        else if (payload.assetId) onReplaceAsset?.(target.replace.itemId, payload.assetId);
        return;
      }
      if (payload.mediaId) onDropMedia?.(payload.mediaId, target.at, layer);
      else if (payload.assetId) onDropAsset?.(payload.assetId, target.at, layer);
      else if (payload.file) onDropLocalFile?.(payload.file, payload.kind, target.at, layer);
      else if (payload.search) onDropSearchHit?.(payload.search, target.at, layer);
    },
  });
  const interval = [0.1, .2, .5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600].find(value => value * scale >= 72) ?? Math.ceil(span / 8 / 3600) * 3600;
  const ticks = Array.from({ length: Math.floor(span / interval) + 1 }, (_, index) => index * interval);
  const sharedPointer = { onPointerMove: move, onPointerUp: end, onPointerCancel: cancelDrag };
  const guide = ghost?.guide ?? externalDrop?.guide ?? scrubGuide ?? null;
  // Stacking is legal, but it hides one clip behind another, so a drop that would do it says so.
  const HATCH = { backgroundImage: "repeating-linear-gradient(45deg, rgb(255 218 42 / .35) 0 6px, transparent 6px 12px)" };
  const ghostClash = !!ghost && ghost.kind === "move" && ghost.index === undefined
    && timelineCollides(sequence, ghost.layer, ghost.at, ghost.duration, [ghost.id, ...group.current.map(entry => entry.id)]);
  const dropClash = !!externalDrop && !externalDrop.replace && !!externalDrop.payload
    && timelineCollides(sequence, externalDrop.layer, externalDrop.at, dropDuration(externalDrop.payload));
  /** The playhead lands on cuts the same way clips do, so a scrub can sit exactly on a boundary. */
  const scrubTo = (event: { clientX: number; metaKey: boolean; ctrlKey: boolean }) => {
    const raw = Math.min(seconds, positionAt(event.clientX));
    const pull = magnet(event) ? snapTime(raw, targets(), tolerance) : { at: raw, guide: null };
    setScrubGuide(pull.guide);
    onSeek(Math.max(0, Math.min(seconds, roundFrame(pull.at))));
  };
  return <div className="flex min-h-0 min-w-0 flex-col gap-2 overflow-hidden">
    <div className="flex flex-wrap items-center gap-2">
      {onPlayToggle && <Button size="icon-xs" variant="secondary" aria-label={playing ? "Pause" : "Play"} aria-pressed={playing} title={playing ? "Pause (Space)" : "Play (Space)"} disabled={!sequence.items.length} onClick={onPlayToggle}>{playing ? <Pause /> : <Play />}</Button>}
      <h2 className="text-sm font-medium">Timeline <span className="ml-2 text-xs tabular-nums text-muted-foreground">{sequence.items.length ? <><PlayheadLabel /> / {timeLabel(seconds)}</> : "Empty"}</span></h2>
      {selection.size > 1
        ? <Button size="xs" variant="secondary" className="mr-auto" onClick={() => setExtra([])}>{selection.size} clips selected · Clear</Button>
        : <span className="mr-auto" />}
      <Button size="icon-xs" variant={snapping ? "secondary" : "ghost"} aria-pressed={snapping} aria-label="Snap to clip edges and the playhead" title="Hold Command or Control while dragging to bypass snapping" onClick={() => setSnapping(value => !value)}><Magnet /></Button>
      <Button size="icon-xs" variant="ghost" aria-label="Zoom out timeline" disabled={zoom <= 1} onClick={() => setZoom(value => Math.max(1, value / 1.5))}><Minus /></Button>
      <Button size="icon-xs" variant="ghost" aria-label="Zoom in timeline" disabled={zoom >= 12} onClick={() => setZoom(value => Math.min(12, value * 1.5))}><Plus /></Button>
      <Button size="xs" variant="outline" title="Add an empty scene on a new track, ready for a title, image or sound" onClick={onBlank}><Plus />Blank scene</Button>
    </div>
    <p id={instructionsId} className="sr-only">Drag clips to move them; drag an edge to trim. Clips move freely on every track and snap to other clips and the playhead; hold Command or Control to bypass snapping, or turn it off with the snapping button. Hold Alt while dragging onto Main to reorder and close gaps. Arrow keys move overlay clips one frame; Shift moves one second. Alt and arrow keys reorder main clips. Shift-click or Command-click to select several clips; dragging one then moves them all. Delete removes the selection. On an edge, arrow keys trim. Escape cancels a drag. Command or Control with the scroll wheel zooms around the pointer, and Shift with the wheel scrolls sideways. Dropping media onto the middle of a matching clip replaces that clip\u2019s media and keeps its place.</p>
    <div ref={viewport} className="min-h-0 max-h-80 select-none overflow-auto rounded-xl bg-black/25" aria-label="Video timeline" onDragStart={event => event.preventDefault()} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) { stopDragScroll(); setExternalDrop(null); } }} onDragEnd={() => { stopDragScroll(); setExternalDrop(null); }}>
      <div className="relative" style={{ width: width + LABEL_WIDTH }}>
        <div className="sticky top-0 z-30 flex h-9 bg-card/95 backdrop-blur-md">
          <span className="sticky left-0 z-40 w-[76px] shrink-0 bg-card" />
          <Ruler max={seconds} className="relative h-9 shrink-0 cursor-crosshair touch-none focus-visible:outline-2 focus-visible:outline-ring" style={{ width }}
            onPointerDown={event => { if (event.button !== 0) return; try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* the pointer ended first */ } scrubTo(event); }}
            onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) scrubTo(event); }}
            onPointerUp={() => setScrubGuide(null)} onPointerCancel={() => setScrubGuide(null)}
            onKeyDown={event => { if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return; event.preventDefault(); onSeek(event.key === "Home" ? 0 : event.key === "End" ? seconds : Math.max(0, Math.min(seconds, playhead.get() + (event.key === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? 1 : 1 / fps)))); }}>
            {ticks.map(t => <span key={t} aria-hidden style={{ left: t * scale }} className="pointer-events-none absolute inset-y-0 border-l border-white/15 pl-1 pt-1 text-[10px] tabular-nums text-muted-foreground">{timeLabel(t)}</span>)}
            <PlayheadMark span={span} scale={scale} className="pointer-events-none absolute bottom-0 h-3 w-3 -translate-x-1/2 rounded-t-sm bg-primary [clip-path:polygon(0_0,100%_0,100%_55%,50%_100%,0_55%)]" />
          </Ruler>
        </div>
        <div data-timeline-layer={newLayer} className={`flex h-8 ${ghost?.layer === newLayer || externalDrop?.layer === newLayer ? "bg-primary/10" : ""}`} {...dropHandlers(newLayer)}>
          <span className="sticky left-0 z-20 flex w-[76px] shrink-0 items-center justify-center bg-card text-muted-foreground"><Plus className="size-3" aria-hidden /></span>
          <div className="relative flex-1 border-b border-dashed border-white/10 px-2 pt-1 text-[11px] text-muted-foreground" onPointerDown={event => { if (event.button === 0 && event.target === event.currentTarget) seekAt(event.clientX); }}>Drop above to create a track
            {(ghost?.layer === newLayer || externalDrop?.layer === newLayer) && <span aria-hidden className="pointer-events-none absolute inset-y-0 w-0.5 bg-primary" style={{ left: (ghost?.layer === newLayer ? ghost.at : externalDrop?.at ?? 0) * scale }} />}
          </div>
        </div>
        {layers.map(layer => <div key={layer} data-timeline-layer={layer} className="flex border-b border-white/5" {...dropHandlers(layer)}>
          <Menu>
            <MenuTrigger render={<button type="button" aria-label={`${layer === 0 ? "Main" : `Track ${layer + 1}`} actions` } className="sticky left-0 z-20 flex w-[76px] shrink-0 items-center gap-1.5 bg-card px-2 text-left text-[11px] text-muted-foreground transition-colors hover:bg-white/8 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring aria-expanded:bg-white/10 aria-expanded:text-foreground" />}>
              {layer === 0 ? <Film className="size-3.5" aria-hidden /> : <Layers className="size-3.5" aria-hidden />}{layer === 0 ? "Main" : `Track ${layer + 1}`}
            </MenuTrigger>
            <MenuContent>
              <ContextMenuLabel>{layer === 0 ? "Main track" : `Track ${layer + 1}`}</ContextMenuLabel>
              <ContextMenuItem onClick={() => selectTrack(layer)}><MousePointerClick />Select its clips</ContextMenuItem>
              {layer !== 0 && <>
                <ContextMenuSeparator />
                <ContextMenuItem disabled={overlayLayers.indexOf(layer) === 0} onClick={() => swapTracks(layer, overlayLayers[overlayLayers.indexOf(layer) - 1])}><ArrowUp />Move track up</ContextMenuItem>
                <ContextMenuItem disabled={overlayLayers.indexOf(layer) === overlayLayers.length - 1} onClick={() => swapTracks(layer, overlayLayers[overlayLayers.indexOf(layer) + 1])}><ArrowDown />Move track down</ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem onClick={() => removeItems(layout.items.filter(entry => (entry.item.layer ?? 0) === layer).map(entry => entry.item.id))}><Trash2 />Remove its clips</ContextMenuItem>
              </>}
            </MenuContent>
          </Menu>
          <div {...marqueeHandlers} className={`group/track relative h-16 shrink-0 touch-none ${externalDrop?.layer === layer ? "bg-primary/5" : ""}`} style={{ width }}>
            {layout.items.filter(entry => (entry.item.layer ?? 0) === layer).map(({ item, from, duration }) => {
              // Two ways to be a sound on this timeline: a standalone music/sfx scene, or a
              // shot whose own audio was lifted off its picture.
              const detached = !!item.mediaId && !!item.hidden;
              const audio = detached || (!item.mediaId && item.clip.edits.length > 0 && item.clip.edits.every(edit => edit.type === "music" || edit.type === "sfx"));
              const active = selection.has(item.id), primary = selectedId === item.id;
              const clipWidth = Math.max(40, duration / fps * scale);
              const moving = ghost?.id === item.id && ghost.kind !== "effect";
              return <ContextMenu key={item.id} onOpenChange={open => {
                if (!open) return;
                // Right-clicking inside a selection keeps it; right-clicking outside one starts over,
                // so the menu never acts on clips the pointer was nowhere near.
                if (!selection.has(item.id)) setExtra([]);
                else setExtra([...selection].filter(id => id !== item.id));
                onSelect(item.id, from / fps);
              }}>
                <ContextMenuTrigger render={<div className={`group absolute top-2 h-12 rounded-md border ${primary ? "z-10 border-primary ring-1 ring-primary" : active ? "z-10 border-primary/70 ring-1 ring-primary/40" : "border-white/20"} ${audio ? "bg-emerald-950" : "bg-zinc-800"} ${moving ? "opacity-35" : ""}`} style={{ left: from / fps * scale, width: clipWidth }} />}>
                <button type="button" draggable={false} aria-label={`Select ${item.clip.title}, ${layer === 0 ? "main track" : `track ${layer + 1}`}${item.keyframes?.length ? `, ${item.keyframes.length} motion keyframes` : ""}`} aria-pressed={active} aria-describedby={instructionsId} className="absolute inset-0 cursor-grab touch-none overflow-hidden rounded-md text-left focus-visible:outline-2 focus-visible:outline-ring active:cursor-grabbing" onPointerDown={event => begin(event, item.id, "move")} {...sharedPointer}
                  onClick={event => {
                    if (!suppressClick.current) {
                      if (event.shiftKey || event.metaKey || event.ctrlKey) toggleSelection(item.id);
                      else { setExtra([]); onSelect(item.id, Math.max(from / fps, Math.min((from + duration - 1) / fps, positionAt(event.clientX)))); if (standaloneScene(item)) onSelectEdit?.(0); }
                    }
                    suppressClick.current = false;
                  }}
                  onKeyDown={event => {
                    if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); removeFrom(item.id); return; }
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
                  {item.mediaId && mediaUrls[item.mediaId] && !detached && <Filmstrip src={mediaUrls[item.mediaId]} start={item.clip.start} end={item.clip.end} />}
                  {item.mediaId && !item.muted && <SourceWaveform projectId={projectId} mediaId={item.mediaId} start={item.clip.start} end={item.clip.end} strong={detached} />}
                  {audio && (() => {
                    const source = item.clip.edits.flatMap(edit => "src" in edit && assetUrls[edit.src] ? [assetUrls[edit.src]] : [])[0];
                    return source
                      ? <Waveform src={source} />
                      : <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-1 h-3 opacity-25" style={{ backgroundImage: "repeating-linear-gradient(90deg, currentColor 0 2px, transparent 2px 6px)" }} />;
                  })()}
                  <span className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/65 via-black/10 to-black/25" />
                  <span className="pointer-events-none relative flex items-center gap-1 px-3 py-1 text-[11px] font-medium text-white">{audio && <Music2 aria-hidden className="size-3 shrink-0" />}<span className="truncate">{shotName(item)}</span>{item.hidden && <EyeOff aria-label="Visuals hidden" className="size-3 shrink-0" />}{item.muted && <VolumeX aria-label="Audio muted" className="size-3 shrink-0" />}</span>
                </button>
                {(["start", "end"] as const).map(edge => <button key={edge} type="button" aria-label={`Trim ${edge} of ${item.clip.title}`} title={`Drag to trim ${edge}; arrow keys adjust one frame`} className={`absolute inset-y-0 z-20 w-3 cursor-ew-resize touch-none rounded-sm bg-primary/80 text-primary-foreground focus-visible:outline-2 focus-visible:outline-ring ${primary ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"} ${edge === "start" ? "left-0" : "right-0"} ${clipWidth >= 64 ? `after:absolute after:inset-y-0 after:w-6 after:content-[''] ${edge === "start" ? "after:left-0" : "after:right-0"}` : ""}`} onPointerDown={event => begin(event, item.id, edge)} {...sharedPointer} onClick={event => event.stopPropagation()} onKeyDown={event => {
                  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                  event.preventDefault();
                  try { commit(buildTimelineTrim(sequence, item.id, edge, (event.key === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? 1 : 1 / fps), media), "Clip trimmed."); } catch (error) { setNotice(error instanceof Error ? error.message : NO_MORE_FOOTAGE); }
                }}><span aria-hidden className="mx-auto block h-5 w-px bg-current/80" /></button>)}
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuLabel>{shotName(item)}</ContextMenuLabel>
                  {onSplit && <SplitItem from={from / fps} until={(from + duration) / fps} onSplit={() => onSplit(item.id)} />}
                  {onDuplicate && <ContextMenuItem shortcut="D" onClick={() => onDuplicate(item.id)}><Copy />Duplicate</ContextMenuItem>}
                  {onAskAgent && <ContextMenuItem onClick={() => onAskAgent(item.id)}><MessageSquare />Ask the agent about this</ContextMenuItem>}
                  <ContextMenuSeparator />
                  <ContextMenuItem onClick={() => commit([{ type: "item.place", sequenceId: sequence.id, itemId: item.id, patch: { muted: !item.muted }, before: { muted: item.muted ?? false } }], item.muted ? "Audio unmuted." : "Audio muted.")}>
                    {item.muted ? <><Volume2 />Unmute audio</> : <><VolumeX />Mute audio</>}
                  </ContextMenuItem>
                  <ContextMenuItem onClick={() => commit([{ type: "item.place", sequenceId: sequence.id, itemId: item.id, patch: { hidden: !item.hidden }, before: { hidden: item.hidden ?? false } }], item.hidden ? "Visuals shown." : "Visuals hidden.")}>
                    {item.hidden ? <><Eye />Show visuals</> : <><EyeOff />Hide visuals</>}
                  </ContextMenuItem>
                  {onDetachAudio && item.mediaId && !item.muted && <ContextMenuItem onClick={() => onDetachAudio(item.id)}><Music2 />Separate audio</ContextMenuItem>}
                  <ContextMenuSeparator />
                  <ContextMenuItem shortcut="Del" onClick={() => removeFrom(item.id)}><Trash2 />{selection.has(item.id) && selection.size > 1 ? `Remove ${selection.size} clips` : "Remove from timeline"}</ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>;
            })}
            {layout.items.filter(entry => (entry.item.layer ?? 0) === layer).map(entry => {
              const joint = joints.get(entry.item.id);
              if (!joint) return null;
              const current = entry.item.transition ?? null;
              // A shot pinned to a fixed time can only blend over the overlap it already has.
              const room = Math.min(joint.maxFrames, joint.overlapFrames ?? joint.maxFrames);
              if (!current && room < 1) return null;
              return <TransitionJointControl key={`joint-${entry.item.id}`} left={entry.from / fps * scale} width={(entry.transition?.frames ?? 0) / fps * scale}
                current={current} title={shotName(entry.item)} previousTitle={shotName(joint.previous)} maxSeconds={room / fps}
                onSet={transition => commit([{ type: "item.transition", sequenceId: sequence.id, itemId: entry.item.id, transition, before: current }],
                  transition ? `${describeTransition(transition)} between “${shotName(joint.previous)}” and “${shotName(entry.item)}”.` : "Transition removed.", true)} />;
            })}
            {/* Every moment a layer on this track is pinned at. An agent's move is drawn the
                same as a hand-made one, so "what did it do" is answered by looking.

                Deliberately not a control. A clip is dragged and trimmed by its whole body,
                and a row of buttons with hit areas big enough to hit would punch holes in it
                — the first keyframe is almost always at zero, exactly where the start trim
                handle lives. Each of these is named, retimed and removed in the Motion panel,
                with full-size controls and a button that seeks to it; here they are a picture.
                The clip's own accessible name carries the count, so the motion is not a
                visual-only fact. */}
            {layout.items.filter(entry => (entry.item.layer ?? 0) === layer).flatMap(entry => (entry.item.keyframes ?? []).map((key, index) => {
              const at = entry.from / fps + key.t;
              if (at > seconds) return null;
              return <span key={`kf-${entry.item.id}-${index}`} aria-hidden
                title={`${key.t.toFixed(2)}s · ${keyframeSummary(key)} · ${describeAuthor(key.by)}`}
                className={`pointer-events-none absolute top-[46px] z-20 size-2.5 -translate-x-1/2 rotate-45 rounded-[2px] border border-background ${isAgentAuthor(key.by) ? "bg-primary" : "bg-white"}`}
                style={{ left: at * scale }} />;
            }))}
            {!sequence.items.length && layer === 0 && <span className="pointer-events-none absolute inset-2 flex items-center rounded-md border border-dashed border-white/20 px-3 text-xs text-muted-foreground">Drop videos here to start</span>}
            {ghost && ghost.layer === layer && ghost.kind !== "effect" && <div aria-hidden className={`pointer-events-none absolute top-1 z-30 h-14 rounded-md border-2 border-primary ${ghost.kind === "move" && ghost.index !== undefined ? "w-1 bg-primary" : ghostClash ? "" : "bg-primary/15"}`} style={{ left: ghost.at * scale, width: ghost.kind === "move" && ghost.index !== undefined ? 3 : Math.max(8, ghost.duration * scale), ...(ghostClash ? HATCH : {}) }}><span className="absolute left-1 top-0 whitespace-nowrap rounded bg-black/85 px-1 text-[10px] text-white">{ghost.kind === "move" ? (ghost.index !== undefined ? "Insert here" : ghostClash ? `Stacks · ${timeLabel(ghost.at)}` : timeLabel(ghost.at)) : `${ghost.duration.toFixed(1)}s`}</span></div>}
            {ghost?.kind === "move" && ghost.index === undefined && group.current.length > 1 && group.current.filter(entry => entry.id !== ghost.id && Math.max(0, entry.layer + (ghost.lift ?? 0)) === layer).map(entry => {
              const at = Math.max(0, entry.at + (ghost.shift ?? 0));
              return <div key={entry.id} aria-hidden className="pointer-events-none absolute top-1 z-30 h-14 rounded-md border-2 border-primary/70 bg-primary/10" style={{ left: at * scale, width: Math.max(8, entry.duration * scale) }} />;
            })}
            {externalDrop?.layer === layer && externalDrop.replace && <div aria-hidden className="pointer-events-none absolute top-2 z-30 h-12 rounded-md border-2 border-primary bg-primary/25 ring-2 ring-primary/50" style={{ left: externalDrop.replace.at * scale, width: Math.max(40, externalDrop.replace.duration * scale) }}><span className="absolute inset-x-0 top-1/2 -translate-y-1/2 truncate px-2 text-center text-[11px] font-medium text-white">Replace</span></div>}
            {externalDrop?.layer === layer && !externalDrop.replace && <div aria-hidden className={`pointer-events-none absolute inset-y-1 z-30 rounded-md border-2 border-dashed border-primary ${dropClash ? "" : "bg-primary/15"}`} style={{ left: externalDrop.at * scale, width: externalDrop.payload ? Math.max(3, dropDuration(externalDrop.payload) * scale) : 3, ...(dropClash ? HATCH : {}) }}><span className="absolute left-1 top-0 max-w-40 truncate whitespace-nowrap rounded bg-black/85 px-1 text-[10px] text-white">{externalDrop.files ? "Import here" : dropClash ? `Stacks on ${externalDrop.payload?.name ?? "this track"}` : externalDrop.payload?.name ?? (layer === 0 ? "Insert here" : "Add here")}</span></div>}
          </div>
        </div>)}
        {selected && selectedMap && effectTypes.map(type => <div key={type} className="flex border-b border-white/5">
          <span className="sticky left-0 z-20 flex w-[76px] shrink-0 items-center bg-card px-2 text-[10px] text-muted-foreground">{({ silence: "Cuts", punch: "Zoom", emphasis: "Emphasis", text: "Titles", image: "Images", music: "Music", sfx: "Sounds" })[type]}</span>
          <div className="relative h-8" style={{ width }} onPointerDown={event => { if (event.button === 0 && event.target === event.currentTarget) seekAt(event.clientX); }}>
            {selected.item.clip.edits.map((edit, index) => {
              if (edit.type !== type) return null;
              // While an edge is dragged the block shows where it would land, the same way a clip does.
              const resizing = ghost && ghost.index === index && (ghost.kind === "effect-start" || ghost.kind === "effect-end") ? ghost : null;
              const shift = ghost?.kind === "effect" && ghost.index === index ? ghost.delta : resizing?.kind === "effect-start" ? resizing.delta : 0;
              const at = selected.from / fps + Math.max(0, srcToOut(selectedMap, edit.t) + shift);
              const span = Math.max(1 / fps, srcToOut(selectedMap, edit.t + edit.d) - srcToOut(selectedMap, edit.t));
              const duration = Math.max(1 / fps, resizing ? (resizing.kind === "effect-end" ? span + resizing.delta : span - resizing.delta) : span);
              const swappable = (payload: DragPayload | null) => !!payload && !!onReplaceAsset && !payload.file
                && (payload.kind === "image" ? edit.type === "image" : payload.kind === "audio" && (edit.type === "music" || edit.type === "sfx"));
              return <button key={index} type="button" aria-label={`${effectLabel(edit)} effect`}
                onDragOver={event => {
                  if (!hasMediaDrag(Array.from(event.dataTransfer.types)) || !swappable(activeDrag())) return;
                  event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = "copy"; setEffectDrop(index);
                }}
                onDragLeave={() => setEffectDrop(null)}
                onDrop={event => {
                  const payload = readDrag(event.dataTransfer);
                  setEffectDrop(null);
                  if (!payload?.assetId || !swappable(payload)) return;
                  event.preventDefault(); event.stopPropagation();
                  onReplaceAsset?.(selected.item.id, payload.assetId, index);
                }} aria-pressed={selectedEdit === index} title={`${effectLabel(edit)} · ${describeAuthor(edit.by)} · drag to move`} className={`group/effect absolute top-1 h-6 cursor-grab touch-none overflow-visible rounded px-2 text-left text-[10px] focus-visible:outline-2 focus-visible:outline-ring active:cursor-grabbing ${isAgentAuthor(edit.by) ? "shadow-[inset_0_0_0_1px_var(--primary)] " : ""}${effectDrop === index ? "border-2 border-primary bg-primary/40" : selectedEdit === index ? "border border-primary bg-primary/30" : "border border-white/15 bg-white/10"}`} style={{ left: at * scale, width: Math.max(24, duration * scale) }} onPointerDown={event => begin(event, selected.item.id, "effect", index)} {...sharedPointer} onClick={event => { if (!suppressClick.current) { seekAt(event.clientX); onSelectEdit?.(index); } suppressClick.current = false; }} onKeyDown={event => {
                if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                event.preventDefault(); moveEffect(sequence, selected.item.id, index, (event.key === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? 1 : 1 / fps));
              }}><span className="whitespace-nowrap">{effectLabel(edit)}</span>
                {(["start", "end"] as const).map(edge => <span key={edge} role="button" tabIndex={0} aria-label={`Trim ${edge} of ${effectLabel(edit)}`} title={`Drag to change how long this runs; arrow keys adjust one frame`}
                  className={`absolute inset-y-0 z-20 w-2 cursor-ew-resize touch-none rounded-sm bg-primary/80 ${selectedEdit === index ? "opacity-100" : "opacity-0 group-hover/effect:opacity-100 focus-visible:opacity-100"} ${edge === "start" ? "left-0" : "right-0"}`}
                  onPointerDown={event => begin(event, selected.item.id, edge === "start" ? "effect-start" : "effect-end", index)} {...sharedPointer}
                  onClick={event => event.stopPropagation()}
                  onKeyDown={event => {
                    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                    event.preventDefault(); event.stopPropagation();
                    resizeEffect(sequence, selected.item.id, index, edge, (event.key === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? 1 : 1 / fps));
                  }} />)}
              </button>;
            })}
          </div>
        </div>)}
        <PlayheadMark span={span} scale={scale} offset={LABEL_WIDTH} className="pointer-events-none absolute bottom-0 top-9 z-10 w-px bg-primary" />
        {guide && <span aria-hidden className="pointer-events-none absolute bottom-0 top-9 z-40 w-px bg-white shadow-[0_0_6px_rgba(255,255,255,.55)]" style={{ left: LABEL_WIDTH + guide.at * scale }}><span className="absolute -top-px left-1/2 size-1.5 -translate-x-1/2 rotate-45 bg-white" /></span>}
      </div>
    </div>
    {marquee && <div aria-hidden className="pointer-events-none fixed z-50 rounded-sm border border-primary bg-primary/15" style={{ left: Math.min(marquee.x0, marquee.x1), top: Math.min(marquee.y0, marquee.y1), width: Math.abs(marquee.x1 - marquee.x0), height: Math.abs(marquee.y1 - marquee.y0) }} />}
    <p className="text-[11px] text-muted-foreground">Drag clips to move them · Drop media on a clip to replace it</p>
    <p className="sr-only" role="status">{notice}</p>
  </div>;
}
