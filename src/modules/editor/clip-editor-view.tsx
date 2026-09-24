"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Player, type PlayerRef } from "@remotion/player";
import { ArrowLeft, Check, ChevronLeft, ChevronRight, Download, FolderOpen, ImagePlus, Loader2, MousePointerClick, Music2, Plus, Redo2, Scissors, Settings2, Square, Type, Undo2, Wand2 } from "lucide-react";
import { promoteClipToSequence } from "@/modules/editor/lib/editable-timeline";
import { shotName } from "@/modules/editor/lib/canvas";
import { audioLayer, titleLayer } from "@/modules/editor/lib/tracks";
import { LayerInspector } from "./components/layer-inspector";
import { MotionInspector } from "./components/motion-inspector";
import { CanvasGrid, CanvasSelection } from "./components/canvas-selection";
import { type CanvasPreview } from "./types";
import { ClipToolbar } from "./components/clip-toolbar";
import { DEFAULT_PALETTE, TOOLBAR_ROW } from "./data";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../../common/ui/dialog";
import { Menu, MenuContent, MenuTrigger, ContextMenuItem } from "../../common/ui/context-menu";
import { SequenceComposition } from "@/../remotion/SequenceComposition";
import { Button, buttonVariants } from "../../common/ui/button";
import { cn } from "cn";
import { Input } from "../../common/ui/input";
import { Card, CardContent } from "../../common/ui/card";
import { Disclosure } from "../../common/ui/disclosure";
import { Glass } from "../../common/ui/glass";
import { ScrollArea } from "../../common/ui/scroll-area";
import { Separator } from "../../common/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../common/ui/tabs";
import { ClipInspector } from "./components/clip-inspector";
import { CaptionControls } from "./components/caption-controls";
import { OverlayEditor } from "./components/overlay-editor";
import { EditorStatus } from "./components/editor-status";
import { EditorProperties } from "./components/editor-properties";
import { useProjectChat } from "@/modules/agent/hooks/use-chat";
import { AgentEditor } from "../agent/components/agent-editor";
import { MediaBrowser } from "../media/components/media-browser";
import { SequenceTimeline } from "./components/sequence-timeline";
import { frameLabel, parseTimecode } from "./lib/sequence-timeline";
import { SequenceSettings } from "./components/sequence-settings";
import { Shortcuts } from "./components/shortcuts";
import { toast } from "sonner";
import { TemplatePanel } from "../templates/components/template-panel";
import { CommentPanel } from "../stream-comments/components/comment-panel";
import { RulesPanel } from "../rules/components/rules-panel";
import { PlanPanel } from "../plan/components/plan-panel";
import { useEditor } from "@/modules/editor/hooks/use-editor";
import { patchFromClip, type EditorOperation } from "@/modules/editor/lib/operations";
import { assetEdit } from "@/modules/editor/lib/asset-edit";
import { classifyFile, hasFileDrag, hasMediaDrag, readDrag, type DragKind, type DragPayload } from "@/modules/editor/lib/dnd";
import { snapTargets } from "@/modules/editor/lib/snapping";
import { createPlayheadStore, PlayheadProvider, usePlayheadSelector } from "@/modules/editor/hooks/playhead";
import { buildTimelineSlip } from "@/modules/editor/lib/timeline-interactions";
import { adoptSearchHit, importFiles, importLocalFile, importedDuration } from "@/modules/editor/hooks/upload";
import { type Imported } from "@/modules/editor/types";
import { api, assetUrl, clipUrl, type AssetSummary } from "@/common/api/client";
import { buildTimeMap, srcToOut } from "@/modules/editor/lib/timeline";
import { sequenceFrames, transitionJoints } from "@/modules/editor/lib/sequences";
import { itemSeconds, staticState } from "@/modules/editor/lib/keyframes";
import { fmt } from "@/modules/transcription/lib/transcript";
import { Clip as ClipSchema, type Clip, type Edit, type Edl, type SequenceItem } from "@/modules/editor/types";
import { emptySequencePlan } from "@/modules/plan/types";
import { uid, sourceSecondsAt } from "./lib/clip-editor-view";
import { type TemplateOption } from "./types";
import { EMPTY, MIN_PREVIEW_PX, NEW_EDIT, PLAYBACK_RATES } from "./data";

/** A single editor for generated clips, imported footage, and source-free canvases. */
export function ClipEditor({ projectId, projectName, edl: initialEdl, revision, clipId, sequenceId }: {
  projectId: string; projectName: string; edl: Edl; revision: number; clipId?: string; sequenceId?: string;
}) {
  const router = useRouter();
  const editor = useEditor(projectId, { edl: initialEdl, revision });
  const savedEdl = editor.snapshot!.edl;
  const [activeSequenceId, setActiveSequenceId] = useState(sequenceId ?? clipId ?? initialEdl.sequences[0]?.id ?? initialEdl.clips[0]?.id ?? "");
  useEffect(()=>{const id=sequenceId ?? clipId;if(id)setActiveSequenceId(id);},[sequenceId,clipId]);
  const legacy = savedEdl.clips.some(c => c.id === activeSequenceId);
  // Projection is read-only. The first edit promotes this output atomically, retaining its ID.
  const edl = useMemo(() => legacy ? promoteClipToSequence(savedEdl, activeSequenceId) : savedEdl, [savedEdl, activeSequenceId, legacy]);
  const dispatch = (ops: EditorOperation[]) => editor.dispatch(legacy ? [{type:"clip.promote",clipId:activeSequenceId}, ...ops] : ops);
  const dispatched = (ops: EditorOperation[]) => dispatch(ops) === true;
  const { save, dirty, saving } = editor;
  const [canvasSelected,setCanvasSelected]=useState(false),[playing,setPlaying]=useState(false);
  /**
   * How fast the preview runs. A review pass wants to be quicker than the video and
   * finding the frame a cut belongs on wants to be slower, and neither is a different
   * activity from watching it. It touches nothing but this player: the project, the
   * export and the agent never hear about it.
   */
  const [rate,setRate]=useState(1);
  const [canvasPreview,setCanvasPreview]=useState<CanvasPreview>(null);
  const [activeItemId, setActiveItemId] = useState("");
  const sequence = edl.sequences.find(s => s.id === activeSequenceId);
  const item = sequence?.items.find(i => i.id === activeItemId) ?? sequence?.items[0];
  const clip = item?.clip ?? EMPTY;
  const hasContent = !!item;
  /**
   * Whether a clip was actually picked, rather than the editor falling back to the first
   * one so there is something to preview. The properties column follows this: until you
   * choose something, it has nothing to say.
   */
  const picked = !!activeItemId && !!sequence?.items.some(i => i.id === activeItemId);
  const output = sequence?.output ?? edl.output;
  const source = edl.media.find(m => m.id === item?.mediaId) ?? null;
  const [actionError, setActionError] = useState<string | null>(null);
  const [assetBusy, setAssetBusy] = useState(false);
  const [templateOptions, setTemplateOptions] = useState<TemplateOption[]>([]);
  /** Which of the video’s own panels is open. None by default: the frame is the editor. */
  const [panel, setPanel] = useState<null | "plan" | "rules" | "comment" | "settings">(null);
  useEffect(() => { api.editorTool<TemplateOption[]>(projectId, { tool: "templates.list" }).then(list => setTemplateOptions(list.map(t => ({ id: t.id, name: t.name, brand: t.brand })))).catch(() => {}); }, [projectId]);
  const [fileDrag, setFileDrag] = useState(false);
  const clipboard = useRef<SequenceItem | null>(null);
  const [libraryDrag, setLibraryDrag] = useState(false);
  const [canvasDrop, setCanvasDrop] = useState<{ x: number; y: number } | null>(null);
  const [pendingDrop, setPendingDrop] = useState<{ queue: Imported[]; placement: { at: number; layer: number } | null; spot?: { x: number; y: number } } | null>(null);
  const [assetPanelOpen, setAssetPanelOpen] = useState(false);
  /**
   * Asking for a picture or a sound points the asset browser at that kind and puts the
   * cursor in its search box. On a wide screen the browser is always on show, so a button
   * that only unhid it did nothing at all where most editing happens.
   */
  const [assetFocus, setAssetFocus] = useState<{ kind: "image" | "audio"; nonce: number } | null>(null);
  const browseAssets = (kind: "image" | "audio") => { setAssetPanelOpen(true); setAssetFocus({ kind, nonce: Date.now() }); };
  const addGroupId = useId(), clipGroupId = useId();
  const [propertiesOpen, setPropertiesOpen] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  // The playhead is not state: see src/modules/editor/hooks/playhead.ts for why the editor must
  // not re-render thirty times a second while the preview plays.
  const [playhead] = useState(createPlayheadStore);
  const [rendering, setRendering] = useState(false);
  const [download, setDownload] = useState(false);
  const [tab, setTab] = useState<"captions" | "overlays" | "edit">("captions");
  const player = useRef<PlayerRef>(null);
  /**
   * The project's one conversation. Held here rather than inside the panel because the
   * timeline needs it as well: what the agent is working on is drawn around the clip it
   * is working on, and that is read out of the conversation, not out of a flag.
   */
  const chat = useProjectChat(projectId, {
    beforeRun: save,
    afterUndo: editor.reload,
    context: () => ({ sequenceId: sequence ? activeSequenceId : undefined, selection: item ? [item.id] : [], playhead: playhead.get() }),
  });
  const previewArea = useRef<HTMLDivElement>(null);
  const [previewSize,setPreviewSize] = useState({width:0,height:0});
  useEffect(()=>{
    const el=previewArea.current;if(!el)return;
    const observer=new ResizeObserver(([entry])=>{
      const width=Math.min(entry.contentRect.width,entry.contentRect.height*output.width/output.height);
      // The frame is sized from this number, so the observed box never resizes because of it and
      // the observer never fires again. A reading taken before the column has laid out is therefore
      // permanent, and it leaves a frame too small to see — which is a blank middle of the editor.
      // Anything degenerate keeps the CSS box, which already fits the frame to the space it has.
      setPreviewSize(width>=MIN_PREVIEW_PX?{width,height:width*output.height/output.width}:{width:0,height:0});
    });
    observer.observe(el);return()=>observer.disconnect();
  },[output.width,output.height]);
  const map = useMemo(() => buildTimeMap(clip), [clip]);
  const allocation = useMemo(() => sequence ? sequenceFrames(sequence) : null, [sequence]);
  /** The joint this shot arrives on, if it has one: the same answer the timeline's seam gets. */
  const joint = useMemo(() => {
    if (!sequence || !item) return null;
    const found = transitionJoints(sequence).get(item.id);
    if (!found) return null;
    const room = Math.min(found.maxFrames, found.overlapFrames ?? found.maxFrames);
    return { sequenceId: sequence.id, itemId: item.id, previousTitle: shotName(found.previous), maxSeconds: room / sequence.output.fps, current: item.transition ?? null };
  }, [sequence, item]);
  /** The layer's motion, and what a keyframe added by hand should start out as. */
  const motion = useMemo(() => {
    if (!sequence || !item) return null;
    return { sequenceId: sequence.id, itemId: item.id, seconds: itemSeconds(item, sequence.output.fps),
      current: item.keyframes ?? null, seed: staticState(item) as unknown as Record<string, number> };
  }, [sequence, item]);
  const itemOffset = (allocation?.items.find(i => i.item.id === item?.id)?.from ?? 0) / output.fps;
  /** The playhead inside the selected clip, in that clip's own output seconds. */
  const localAt = (seconds: number) => Math.max(0, Math.min(map.duration, seconds-itemOffset));
  const targetId = sequence?.id ?? clipId;

  /**
   * A hidden tab stops playing rather than pretending to.
   *
   * The Player runs off `requestAnimationFrame` and falls back to a timer when the tab
   * goes to the background — a timer every browser throttles to about once a second, so
   * a preview left playing there advances one frame a second while the sound keeps its
   * own time. Nothing can make a hidden tab play thirty frames a second, so the choice
   * is between crawling and stopping, and coming back to the frame you left is worth
   * more than coming back forty seconds adrift of it.
   */
  useEffect(() => {
    const hide = () => { if (document.visibilityState !== "visible") player.current?.pause(); };
    document.addEventListener("visibilitychange", hide);
    return () => document.removeEventListener("visibilitychange", hide);
  }, []);
  useEffect(() => {
    const p = player.current; if (!p) return;
    const onFrame = () => playhead.set(p.getCurrentFrame()/output.fps);
    const onPlay=()=>setPlaying(true),onPause=()=>setPlaying(false);
    p.addEventListener("frameupdate", onFrame);p.addEventListener("play",onPlay);p.addEventListener("pause",onPause);
    return () => {p.removeEventListener("frameupdate",onFrame);p.removeEventListener("play",onPlay);p.removeEventListener("pause",onPause);};
  }, [playhead, output.fps, !!sequence?.items.length]);
  useEffect(() => {
    let disposed = false;
    const refresh = async () => { try {
      const p = await api.getProject(projectId);
      if (!disposed) { setDownload(p.revision === editor.snapshot!.revision && !!targetId && p.rendered.includes(targetId)); setRendering(p.job?.kind === "render" && (p.job.status === "running" || p.job.status === "queued")); }
    } catch { /* keep the editor usable during a transient failure */ } };
    void refresh(); const timer = setInterval(refresh, 1500); return () => { disposed = true; clearInterval(timer); };
  }, [projectId, targetId, editor.snapshot!.revision]);
  /** Scrubbing parks the preview on one frame, so a seek always pauses first. */
  const seek = useCallback((seconds: number) => { player.current?.pause(); player.current?.seekTo(Math.round(seconds*output.fps)); playhead.set(seconds); },[playhead, output.fps]);
  /** Where the playhead sits in the selected clip's source time, across its silence cuts. */
  const playheadInSource = () => {
    const localSec = localAt(playhead.get());
    const span = map.spans.find(s => localSec >= s.outStart && localSec < s.outStart+s.srcEnd-s.srcStart);
    return Math.max(0, Math.min(span ? span.srcStart+localSec-span.outStart : localSec, clip.end-clip.start-0.01));
  };
  const assetUrls = useMemo(() => Object.fromEntries((sequence ? sequence.items.map(i=>i.clip) : [clip]).flatMap(c=>c.edits.flatMap(e=>"src" in e ? [[e.src,assetUrl(projectId,e.src)]] : []))),[sequence,clip,projectId]);
  const mediaUrls = useMemo(() => Object.fromEntries(edl.media.map(m=>[m.id,savedEdl.media.some(stored=>stored.id===m.id) ? `/api/projects/${projectId}/media/${m.id}` : `/api/projects/${projectId}/source`])),[edl.media,savedEdl.media,projectId]);

  const mapOperations = (ops: EditorOperation[]): EditorOperation[] => !sequence || !item ? ops : ops.flatMap((op):EditorOperation[] => {
    if (op.type === "clip.patch") {
      const mapped:EditorOperation[]=[{type:"item.patch",sequenceId:sequence.id,itemId:item.id,patch:op.patch,before:op.before}];
      if((item.layer??0)===0 && (op.patch.start!==undefined || op.patch.end!==undefined)) mapped.push({type:"item.reorder",sequenceId:sequence.id,itemId:item.id,layer:0,index:allocation!.items.filter(i=>(i.item.layer??0)===0).sort((a,b)=>a.from-b.from).findIndex(i=>i.item.id===item.id)});
      return mapped;
    }
    if (op.type === "output.patch") return [{ type: "sequence.patch", sequenceId: sequence.id, output: { ...sequence.output, ...op.patch } }];
    return [op];
  });
  const update = (next: Clip) => { if (hasContent) dispatch(mapOperations([patchFromClip(clip,next)])); };
  const resetSelection = () => { setSelected(null); setPropertiesOpen(false); setTab("captions"); };
  const newSequence = () => {
    const id = uid("s"); dispatch([{ type: "sequence.add", sequence: { id, title: `Video ${edl.sequences.length+1}`, output: { ...edl.output }, items: [], plan: emptySequencePlan() } }]);
    setActiveSequenceId(id); setActiveItemId(""); seek(0); resetSelection();
  };
  const topLayer = () => Math.max(0,...(sequence?.items.map(i=>i.layer ?? 0) ?? []))+1;
  const mainEnd = () => Math.max(0,...(allocation?.items.filter(i=>(i.item.layer ?? 0)===0).map(i=>i.from+i.duration) ?? []))/output.fps;
  const addCanvas = (edit?: Edit, title = "Blank scene", placement?:{at:number;layer:number}) => {
    if (!sequence) return;
    const id = uid("layer"), duration = edit ? edit.d : 5;
    const at = placement?.at ?? playhead.get();
    // A piece of music is not an overlay on the picture: it belongs on the audio track,
    // beside the rest of the sound, wherever it was asked for.
    const sound = edit?.type === "music" || edit?.type === "sfx";
    // Sound belongs on the audio tracks and a title belongs with the other titles; only
    // something that really is a new picture layer gets a track all to itself.
    const layer = placement?.layer
      ?? (sound ? audioLayer(sequence, at, duration)
      : edit?.type === "text" ? titleLayer(sequence, at, duration)
      : topLayer());
    const ops:EditorOperation[]=[{type:"item.add",sequenceId:sequence.id,item:{id,mediaId:null,at,layer,clip:ClipSchema.parse({id,title,start:0,end:duration,captions:{preset:"none"},edits:edit ? [{...edit,t:0}] : []})}}];
    if(layer===0)ops.push({type:"item.reorder",sequenceId:sequence.id,itemId:id,layer:0,index:allocation!.items.filter(i=>(i.item.layer??0)===0).sort((a,b)=>a.from-b.from).filter(i=>at>=(i.from+i.duration/2)/output.fps).length});
    dispatch(ops);
    setActiveItemId(id); setCanvasSelected(true); player.current?.pause(); if(placement)seek(at); resetSelection();
    if(edit) { setSelected(0); setTab("edit"); }
  };
  /** Where a drop landed inside the frame, 0..1 on each axis. */
  type Spot = { x: number; y: number };
  const appendVideo = (mediaId: string, overlay = false, drop?:{at:number;layer:number}, spot?: Spot) => {
    setActionError(null);
    const media = edl.media.find(m=>m.id===mediaId) ?? (mediaId === "primary_source" && edl.source ? {...edl.source,id:mediaId,name:projectName} : undefined);
    if (!media || !sequence) { setActionError("Choose a timeline and an available source."); return undefined; }
    const ops: EditorOperation[] = [];
    if (!edl.media.some(m=>m.id===media.id)) ops.push({type:"media.add",media});
    const id=uid("i"), at=drop?.at ?? (overlay ? playhead.get() : mainEnd());
    ops.push({type:"item.add",sequenceId:sequence.id,item:{id,mediaId:media.id,at,layer:drop?.layer ?? (overlay ? topLayer() : 0),
      ...(spot ? {transform:{x:Math.round((spot.x*100-15)*10)/10,y:Math.round((spot.y*100-15)*10)/10,width:30,height:30,rotation:0,opacity:1}}
        : overlay ? {transform:{x:65,y:5,width:30,height:30,rotation:0,opacity:1}} : {}),
      clip:ClipSchema.parse({id,title:media.name,start:0,end:media.durationSec,captions:{preset:"none"}})}});
    if(drop?.layer===0){
      const index=allocation!.items.filter(i=>(i.item.layer??0)===0).sort((a,b)=>a.from-b.from).filter(i=>drop.at>=(i.from+i.duration/2)/output.fps).length;
      ops.push({type:"item.reorder",sequenceId:sequence.id,itemId:id,layer:0,index});
    }
    dispatch(ops); setActiveItemId(id); setCanvasSelected(true); player.current?.pause(); seek(at); resetSelection();
    return media.name;
  };
  const placeAsset = (asset: AssetSummary, mode?: "music" | "sfx", placement?:{at:number;layer:number}, spot?: Spot) => {
    const duration = asset.kind === "audio" && mode !== "sfx" ? Math.max(5,(allocation?.duration ?? 0)/output.fps-(placement?.at??playhead.get())) : 3;
    const edit = assetEdit(asset,0,duration,mode);
    // An image dropped on the frame keeps the spot it was dropped on; audio has no position.
    addCanvas(spot && edit.type === "image" ? {...edit, x: Math.round(spot.x*1000)/1000, y: Math.round(spot.y*1000)/1000} : edit, asset.name, placement);
    return asset.name;
  };
  /** A library video becomes project media and a shot in one revision, through the same media.import an agent calls. */
  const placeLibraryVideo = async(assetId:string,placement?:{at:number|null;layer:number})=>{
    if(!sequence){setActionError("Choose a timeline first.");return;}
    if(!(await save()))return;
    const current=await api.getProject(projectId);
    const at=placement?.at===undefined?null:placement.at;
    await api.editorTool(projectId,{tool:"media.import",file:assetId,expectedRevision:current.revision,place:{sequenceId:sequence.id,at,layer:placement?.layer??0}});
    await editor.reload();
    notify("Library video added.");
  };
  const findAsset = async(assetId:string)=>{
    const lists=await Promise.all(["image","audio","video"].map(kind=>api.editorTool<AssetSummary[]>(projectId,{tool:"assets.list",kind})));
    const asset=lists.flat().find(a=>a.id===assetId);
    if(!asset)throw new Error("This asset is no longer available.");
    return asset;
  };
  /**
   * A music bed for the whole video, not for the shot that happened to be picked when it
   * was chosen: it starts at zero, runs the length of the programme, and lands on the
   * audio track under the picture.
   */
  const placeMusicBed = (assetId: string) => void (async()=>{
    try {
      if(!sequence) throw new Error("Choose a video first.");
      const asset=await findAsset(assetId);
      const duration=Math.max(5,(allocation?.duration ?? 0)/output.fps);
      addCanvas(assetEdit(asset,0,duration,"music"),asset.name,{at:0,layer:audioLayer(sequence,0,duration)});
      notify(`${asset.name} added on the audio track.`);
    } catch(error){ setActionError((error as Error).message); }
  })();
  const dropAsset = async(assetId:string,at:number,layer:number,spot?:Spot)=>{
    try {
      const asset=await findAsset(assetId);
      if(asset.kind==="video"){await placeLibraryVideo(assetId,{at,layer});return;}
      placeAsset(asset,asset.kind==="audio"?"music":undefined,{at,layer},spot);
    }catch(error){setActionError((error as Error).message);}
  };
  /** Swapping footage keeps the item, its place on the timeline and the overlays written on it. */
  const replaceMedia = (itemId:string,mediaId:string)=>{
    setActionError(null);
    const target=sequence?.items.find(i=>i.id===itemId), media=edl.media.find(m=>m.id===mediaId);
    if(!sequence||!target||!media)return setActionError("Choose an available source.");
    dispatch([{type:"item.source",sequenceId:sequence.id,itemId,mediaId,title:media.name,before:{mediaId:target.mediaId ?? null}}]);
    setActiveItemId(itemId);setCanvasSelected(true);player.current?.pause();resetSelection();
    notify(`Replaced with ${media.name}.`);
  };
  /** A title, image or sound keeps its timing, position and styling; only its file changes. */
  const replaceAsset = async(itemId:string,assetId:string,editIndex?:number)=>{
    setActionError(null);
    try {
      const target=sequence?.items.find(i=>i.id===itemId);
      const index=editIndex ?? (target?.clip.edits.length===1?0:-1);
      const current=target?.clip.edits[index];
      if(!sequence||!target||!current||!("src" in current))throw new Error("This scene has no replaceable media.");
      const asset=await findAsset(assetId);
      const next={...current,src:asset.id,...("credit" in current?{credit:asset.attribution ?? ""}:{})} as Edit;
      const edits=target.clip.edits.map((edit,i)=>i===index?next:edit);
      dispatch([{type:"item.patch",sequenceId:sequence.id,itemId,patch:{edits},before:{edits:target.clip.edits}}]);
      setActiveItemId(itemId);setCanvasSelected(true);resetSelection();
      notify(`Replaced with ${asset.name}.`);
    }catch(error){setActionError((error as Error).message);}
  };
  /**
   * Files dragged from the desktop take the same route as the Import button: pending edits
   * are flushed, the file is ingested, and the refreshed project places it with the ordinary
   * timeline operations. Placement waits for the reloaded media so nothing lands on a stale EDL.
   */
  const dropFiles = (files: File[], placement: { at: number; layer: number } | null, spot?: Spot, importOnly = false) => {
    setActionError(null); setAssetBusy(true);
    const pending = toast.loading(files.length === 1 ? `Importing ${files[0].name}…` : `Importing ${files.length} files…`);
    void (async () => {
      try {
        if (!(await save())) return;
        const imported = await importFiles(projectId, files);
        await editor.reload();
        if (!importOnly) setPendingDrop({ queue: imported, placement, spot });
        toast.success(importOnly
          ? `${imported.length === 1 ? imported[0].name : `${imported.length} files`} imported. Drag or add it where you want it.`
          : imported.length === 1 ? `${imported[0].name} added.` : `${imported.length} files added.`, { id: pending, duration: 4000 });
      } catch (error) {
        // A multi-file import stops at the first failure, and the files before it are already
        // registered. Take the latest project so the next save is not rejected as stale.
        await editor.reload();
        setActionError((error as Error).message);
        toast.error((error as Error).message, { id: pending, duration: Infinity });
      }
      finally { setAssetBusy(false); }
    })();
  };
  useEffect(() => {
    if (!pendingDrop || !sequence) return;
    const [next, ...rest] = pendingDrop.queue;
    if (!next) return setPendingDrop(null);
    // One placement per render so each item is positioned against the timeline the last one produced.
    if (next.media && !edl.media.some(m => m.id === next.media!.id)) return;
    const placement = pendingDrop.placement;
    if (next.media) appendVideo(next.media.id, (placement?.layer ?? 0) > 0 || !!pendingDrop.spot, placement ?? undefined, pendingDrop.spot);
    else if (next.asset) placeAsset(next.asset, next.asset.kind === "audio" ? "music" : undefined, placement ?? undefined, pendingDrop.spot);
    setPendingDrop(rest.length ? { queue: rest, placement: placement && { ...placement, at: placement.at + importedDuration(next) }, spot: pendingDrop.spot } : null);
  }, [pendingDrop, edl, sequence]); // eslint-disable-line react-hooks/exhaustive-deps
  /** One place decides what an edit says out loud, and whether it offers the way back. */
  const notify = useCallback((message: string, kind: "change" | "error" | "note" = "change") => {
    // A refusal waits to be read and dismissed; a change offers the way back for long enough to
    // take it; a note changed nothing, so it has nothing to undo.
    if (kind === "error") { toast.error(message, { duration: Infinity }); return; }
    if (kind === "note") { toast(message, { duration: 3000 }); return; }
    toast(message, { duration: 8000, action: { label: "Undo", onClick: () => editor.undo() } });
  }, [editor]);
  const itemSpan = (itemId?: string) => allocation?.items.find(entry => entry.item.id === itemId) ?? null;
  /** Where the picked clip sits on the programme, in output seconds, for the controls that need it. */
  const toolbarSpan = (() => {
    const span = itemSpan(item?.id);
    return span ? { from: span.from / output.fps, until: (span.from + span.duration) / output.fps } : null;
  })();
  /** Cut a clip where the playhead sits — the gesture every editor expects from `S`. */
  const splitAtPlayhead = (itemId?: string) => {
    const target = sequence?.items.find(i => i.id === (itemId ?? item?.id));
    const span = itemSpan(target?.id);
    if (!sequence || !target || !span) return;
    // The cut is expressed in the clip's own source time, mapped back through its silence cuts.
    const currentSec = playhead.get();
    const at = sourceSecondsAt(target.clip, currentSec - span.from/output.fps);
    const inside = currentSec > span.from/output.fps + .02 && currentSec < (span.from+span.duration)/output.fps - .02;
    if (!inside || at <= 0 || at >= target.clip.end-target.clip.start) return notify(`Put the playhead inside “${target.clip.title}” to split it.`, "note");
    setActionError(null);
    dispatch([{type:"item.split",sequenceId:sequence.id,itemId:target.id,at,newItemId:uid("i")}]);
  };
  /**
   * Lift a shot's own sound onto its own track. The picture stays where it is and goes
   * muted; the sound becomes an ordinary clip that can be moved, trimmed and levelled
   * under anything else. `item.detachAudio` is the same operation the agent calls.
   */
  const detachAudio = (itemId?: string) => {
    const target = sequence?.items.find(i => i.id === (itemId ?? item?.id));
    if (!sequence || !target) return;
    setActionError(null);
    if (dispatch([{type:"item.detachAudio",sequenceId:sequence.id,itemId:target.id,newItemId:uid("i")}]) !== false)
      notify("Audio separated onto its own track.", "change");
  };
  /** A copy lands right after the original, carrying its trim, placement and overlays. */
  const duplicateSelected = (itemId?: string) => {
    const target = sequence?.items.find(i => i.id === (itemId ?? item?.id));
    const span = itemSpan(target?.id);
    if (!sequence || !target || !span || !allocation) return;
    setActionError(null);
    const id = uid("i"), layer = target.layer ?? 0, at = (span.from+span.duration)/output.fps;
    const ops: EditorOperation[] = [{type:"item.add",sequenceId:sequence.id,item:{...target,id,at,clip:{...target.clip,id}}}];
    if(layer===0){
      const ordered = allocation.items.filter(entry=>(entry.item.layer??0)===0).sort((a,b)=>a.from-b.from);
      ops.push({type:"item.reorder",sequenceId:sequence.id,itemId:id,layer:0,index:ordered.findIndex(entry=>entry.item.id===target.id)+1});
    }
    dispatch(ops); setActiveItemId(id); setCanvasSelected(true); resetSelection();
  };
  /** Copying keeps a clip's trim, overlays and placement so a paste is a real second take. */
  const copySelected = () => {
    if (!item) return;
    clipboard.current = structuredClone(item);
    notify(`Copied ${item.clip.title}.`, "note");
  };
  const pasteClip = () => {
    const source = clipboard.current;
    if (!sequence || !source || !allocation) return;
    const id = uid("i"), layer = source.layer ?? 0;
    const currentSec = playhead.get();
    const ops: EditorOperation[] = [{type:"item.add",sequenceId:sequence.id,item:{...source,id,at:currentSec,clip:{...source.clip,id}}}];
    if(layer===0){
      const ordered = allocation.items.filter(entry=>(entry.item.layer??0)===0).sort((a,b)=>a.from-b.from);
      ops.push({type:"item.reorder",sequenceId:sequence.id,itemId:id,layer:0,index:ordered.filter(entry=>currentSec>=(entry.from+entry.duration/2)/output.fps).length});
    }
    try { dispatch(ops); } catch (error) { return notify((error as Error).message, "error"); }
    setActiveItemId(id); setCanvasSelected(true); resetSelection();
    notify(`Pasted ${source.clip.title}.`);
  };
  useEffect(()=>{
    const typing = (target: EventTarget|null) => target instanceof HTMLElement && (target.isContentEditable || ["INPUT","TEXTAREA","SELECT"].includes(target.tagName));
    const onKey = (event: KeyboardEvent) => {
      // A dialog, menu or popover owns its own keys while it is open.
      if (typing(event.target) || event.altKey) return;
      if (event.target instanceof HTMLElement && event.target.closest('[role="dialog"],[role="menu"]')) return;
      if (event.metaKey || event.ctrlKey) {
        const key = event.key.toLowerCase();
        if (key === "z") { event.preventDefault(); if (event.shiftKey) editor.redo(); else editor.undo(); }
        // Copy and paste only take over when nothing is selected to copy in the ordinary way.
        else if (key === "c" && !window.getSelection()?.toString()) { event.preventDefault(); copySelected(); }
        else if (key === "v") { event.preventDefault(); pasteClip(); }
        return;
      }
      // Transport keys work wherever you are looking, except where a control owns the key:
      // Space belongs to a focused button or link, so it only plays when nothing owns it.
      const owned = document.activeElement instanceof HTMLElement && ["BUTTON", "A", "SUMMARY"].includes(document.activeElement.tagName);
      const duration = (allocation?.duration ?? 0) / output.fps;
      // Read the player, not the last render: holding a step key must not repeat from a stale frame.
      const step = (frames: number) => {
        event.preventDefault();
        const at = player.current ? player.current.getCurrentFrame() / output.fps : playhead.get();
        seek(Math.max(0, Math.min(duration, at + frames / output.fps)));
      };
      // The shifted pair of the frame-step keys, which is where every editor puts this.
      if (event.key === "<" || event.key === ">") {
        event.preventDefault();
        const order = event.key === ">" ? [...PLAYBACK_RATES] : [...PLAYBACK_RATES].reverse();
        setRate(current => order.find(value => (event.key === ">" ? value > current : value < current)) ?? current);
        return;
      }
      if (event.key === "," ) return step(-1);
      if (event.key === "." ) return step(1);
      if (event.key === "k" || (event.key === " " && !owned)) {
        event.preventDefault();
        if (playing) player.current?.pause(); else player.current?.play();
        return;
      }
      // Up and down walk the cuts, which is how a timeline gets reviewed.
      if ((event.key === "ArrowUp" || event.key === "ArrowDown") && sequence) {
        event.preventDefault();
        const edges = snapTargets(sequence, {}).map(point => point.at).filter(at => at <= duration);
        const currentSec = playhead.get();
        const next = event.key === "ArrowDown"
          ? edges.find(at => at > currentSec + 1e-4) ?? duration
          : [...edges].reverse().find(at => at < currentSec - 1e-4) ?? 0;
        return seek(Math.max(0, Math.min(duration, next)));
      }
      if (event.key === "Home") { event.preventDefault(); return seek(0); }
      if (event.key === "End") { event.preventDefault(); return seek(Math.max(0, duration - 1 / output.fps)); }
      if (event.shiftKey) return;
      if (event.key === "s") { event.preventDefault(); splitAtPlayhead(); }
      if (event.key === "d") { event.preventDefault(); duplicateSelected(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  /** A folder-browser file takes the same route as a desktop drop: import, reload, then place. */
  const dropLocalFile = (file: string, kind: DragKind, placement: { at: number; layer: number }) => {
    setActionError(null); setAssetBusy(true);
    const name = file.split("/").pop() ?? file;
    const pending = toast.loading(`Importing ${name}…`);
    void (async () => {
      try {
        if (!(await save())) return;
        const imported = await importLocalFile(projectId, file, kind);
        await editor.reload();
        setPendingDrop({ queue: [imported], placement });
        toast.success(`${imported.name} added.`, { id: pending, duration: 4000 });
      } catch (error) {
        setActionError((error as Error).message);
        toast.error((error as Error).message, { id: pending, duration: Infinity });
      } finally { setAssetBusy(false); }
    })();
  };
  /** An online image is adopted into the library first, then placed like any other asset. */
  const dropSearchHit = (hit: NonNullable<DragPayload["search"]>, placement: { at: number; layer: number } | null, spot?: Spot) => {
    setActionError(null);
    const pending = toast.loading("Fetching the image…");
    void (async () => {
      try {
        const imported = await adoptSearchHit(projectId, hit);
        if (imported.asset) placeAsset(imported.asset, undefined, placement ?? undefined, spot);
        toast.success(`${imported.name} added.`, { id: pending, duration: 4000 });
      } catch (error) {
        setActionError((error as Error).message);
        toast.error((error as Error).message, { id: pending, duration: Infinity });
      }
    })();
  };
  const render = async () => {
    setActionError(null); if(!targetId) return;
    try { if(!(await save())) return; const p=await api.getProject(projectId); await api.render(projectId,[targetId],p.revision); setRendering(true); }
    catch(e){setActionError((e as Error).message);}
  };
  /**
   * One more line, wherever it makes sense for whatever is picked.
   *
   * On a shot with footage it goes inside the shot, at the playhead, so it travels with
   * the picture it belongs to and there can be as many as the shot wants. On a scene with
   * no footage it becomes a scene of its own beside the titles already on the timeline,
   * rather than a second edit inside that one: a scene holding exactly one edit is what
   * the timeline's name for it, the canvas handles and the trim all read as "this shot
   * *is* that title", and a second edit would quietly take all three away.
   */
  const addText = () => {
    if (!sequence) return;
    if (item?.mediaId) {
      dispatch([{type:"item.edit.add",sequenceId:sequence.id,itemId:item.id,edit:NEW_EDIT.text(playheadInSource())}]);
      setSelected(clip.edits.length); setTab("edit");
      return;
    }
    addCanvas(NEW_EDIT.text(0),"Title");
  };
  const addEdit = (kind: string) => {
    if(kind === "text") { addCanvas(NEW_EDIT.text(0),"Title"); return; }
    if(!sequence || !item) return;
    dispatch([{type:"item.edit.add",sequenceId:sequence.id,itemId:item.id,edit:NEW_EDIT[kind](playheadInSource())}]);
    setSelected(clip.edits.length);setTab("edit");
  };
  /** What a Replace button in the asset panel would act on, so the gesture is not drag-only. */
  const replaceable = ((): { kind: "video" | "image" | "audio"; title: string } | undefined => {
    if (!item) return undefined;
    if (item.mediaId) return { kind: "video", title: clip.title };
    const only = clip.edits.length === 1 ? clip.edits[0] : null;
    if (only?.type === "image") return { kind: "image", title: clip.title };
    if (only?.type === "music" || only?.type === "sfx") return { kind: "audio", title: clip.title };
    return undefined;
  })();
  const inspectEdl: Edl = {...edl,output};
  /**
   * The colours the quick controls offer. A video edited under a template edits in that
   * template’s brand kit, so changing a caption colour by hand stays on brand instead of
   * starting a second palette beside it.
   */
  const palette = useMemo(() => {
    const templateId = sequence?.plan.template ?? edl.plan.template;
    const brand = templateOptions.find(t => t.id === templateId)?.brand?.palette ?? {};
    const chosen = [brand.primary, brand.text, brand.secondary, brand.background].filter((color): color is string => !!color);
    return chosen.length ? [...new Set([...chosen, ...DEFAULT_PALETTE])].slice(0, 8) : DEFAULT_PALETTE;
  }, [templateOptions, sequence?.plan.template, edl.plan.template]);
  // A fresh object here re-renders the whole composition on every unrelated editor render.
  const previewProps = useMemo(() => !sequence ? null : ({sequence:canvasPreview ? {...sequence,items:sequence.items.map(i=>i.id===canvasPreview.id?{...i,...(canvasPreview.transform?{transform:canvasPreview.transform}:{}),...(canvasPreview.keyframes?{keyframes:canvasPreview.keyframes}:{}),...(canvasPreview.clip?{clip:canvasPreview.clip}:{})}:i)} : sequence,media:edl.media,mediaUrls,assetUrls,assetBase:`/api/projects/${projectId}/asset/`}), [sequence, canvasPreview, edl.media, mediaUrls, assetUrls, projectId]);

  if(!sequence && activeSequenceId) return <main className="p-8"><h1 className="mb-4 text-xl font-medium">This video is no longer available</h1><Button render={<Link href={`/p/${projectId}`} />}>Back to project</Button></main>;
  /**
   * The frame is the editor, so a press on the picture has to be able to start one. Handles
   * only exist for a layer that is both picked and on screen at the playhead; without them a
   * press landed on the rendered text and selected it, which reads as an editor that has
   * stopped working. So a press with nothing to grab picks the topmost layer showing at the
   * playhead and leaves the handles under the pointer, ready for the next one. A press that
   * already has something to grab is left alone: the handles, the quick actions and every
   * other control below answer it themselves.
   */
  const pickOnCanvas = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !allocation) return;
    if ((event.target as HTMLElement).closest("button,a,input,[role=button]")) return;
    const at = playhead.get() * output.fps;
    const showing = (entry: { item: SequenceItem; from: number; duration: number }) => at >= entry.from && at < entry.from + entry.duration && !entry.item.hidden;
    const held = canvasSelected && item ? allocation.items.find(entry => entry.item.id === item.id) : undefined;
    if (held && showing(held)) return;
    const top = allocation.items.filter(showing).sort((a, b) => (a.item.layer ?? 0) - (b.item.layer ?? 0)).at(-1);
    if (!top) return;
    setActiveItemId(top.item.id); setCanvasSelected(true); resetSelection();
  };
  /**
   * Media dropped on the frame lands where it was dropped: the same operations as a
   * timeline drop, with the frame position carried into the item's transform or the
   * image overlay's own coordinates. Audio ignores the spot and joins at the playhead.
   */
  const frameDropHandlers = {
    onDragOver: (event: React.DragEvent<HTMLDivElement>) => {
      const types = Array.from(event.dataTransfer.types);
      if (!sequence || (!hasMediaDrag(types) && !hasFileDrag(types))) return;
      event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = "copy";
      const rect = event.currentTarget.getBoundingClientRect();
      setCanvasDrop({ x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height });
    },
    onDragLeave: (event: React.DragEvent<HTMLDivElement>) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setCanvasDrop(null); },
    onDrop: (event: React.DragEvent<HTMLDivElement>) => {
      const types = Array.from(event.dataTransfer.types);
      if (!sequence || (!hasMediaDrag(types) && !hasFileDrag(types))) return;
      event.preventDefault();
      const rect = event.currentTarget.getBoundingClientRect();
      const spot = { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) };
      setCanvasDrop(null);
      // The first clip fills the frame; a spot only makes sense once something is under it.
      const placed = !!sequence.items.length;
      if (hasMediaDrag(types)) {
        const payload = readDrag(event.dataTransfer);
        if (!payload) return setActionError("This asset could not be added.");
        if (payload.mediaId) return appendVideo(payload.mediaId, placed, undefined, placed ? spot : undefined);
        if (payload.assetId) return void dropAsset(payload.assetId, playhead.get(), topLayer(), payload.kind === "audio" || !placed ? undefined : spot);
        if (payload.search) return dropSearchHit(payload.search, { at: playhead.get(), layer: topLayer() }, placed ? spot : undefined);
        if (payload.file) return dropLocalFile(payload.file, payload.kind, { at: playhead.get(), layer: placed ? topLayer() : 0 });
      }
      const files = Array.from(event.dataTransfer.files).filter(file => classifyFile(file.name));
      if (!files.length) return setActionError("Those files are not video, image or audio.");
      dropFiles(files, null, placed ? spot : undefined);
    },
  };
  /** Dropping on the asset panel imports into the project without placing anything yet. */
  const libraryDropHandlers = {
    onDragOver: (event: React.DragEvent<HTMLElement>) => {
      if (!hasFileDrag(Array.from(event.dataTransfer.types))) return;
      event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = "copy"; setLibraryDrag(true);
    },
    onDragLeave: (event: React.DragEvent<HTMLElement>) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setLibraryDrag(false); },
    onDrop: (event: React.DragEvent<HTMLElement>) => {
      if (!hasFileDrag(Array.from(event.dataTransfer.types))) return;
      event.preventDefault(); setLibraryDrag(false);
      const files = Array.from(event.dataTransfer.files).filter(file => classifyFile(file.name));
      if (!files.length) return setActionError("Those files are not video, image or audio.");
      dropFiles(files, null, undefined, true);
    },
  };
  const fileDropHandlers = {
    onDragEnter: (event: React.DragEvent) => { if (hasFileDrag(Array.from(event.dataTransfer.types))) setFileDrag(true); },
    onDragOver: (event: React.DragEvent) => {
      if (!hasFileDrag(Array.from(event.dataTransfer.types))) return;
      event.preventDefault(); event.dataTransfer.dropEffect = "copy"; setFileDrag(true);
    },
    onDragLeave: (event: React.DragEvent) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setFileDrag(false); },
    onDrop: (event: React.DragEvent) => {
      if (!hasFileDrag(Array.from(event.dataTransfer.types))) return;
      setFileDrag(false);
      // A track that already handled this drop placed it precisely; do not import it twice.
      if (event.defaultPrevented) return;
      event.preventDefault();
      const files = Array.from(event.dataTransfer.files).filter(file => classifyFile(file.name));
      if (!files.length) return setActionError("Those files are not video, image or audio.");
      dropFiles(files, null);
    },
  };
  return <PlayheadProvider value={playhead}><main {...fileDropHandlers} className="flex min-h-dvh flex-col lg:h-dvh lg:min-h-0 lg:overflow-hidden">
    {fileDrag && <div aria-hidden className="pointer-events-none fixed inset-0 z-50 flex justify-center p-4">
      <div className="absolute inset-2 rounded-3xl border-2 border-dashed border-primary/70 bg-primary/5" />
      <p className="relative mt-3 h-fit rounded-full bg-black/85 px-4 py-2 text-sm text-white shadow-lg">Drop to import — release over a track to place it there</p>
    </div>}

    <Glass shape="panel" className="mx-4 mt-4 flex shrink-0 flex-wrap items-center gap-3 px-4 py-2.5 lg:rounded-full">
      <Link aria-label="Back to project" href={`/p/${projectId}`} className={cn(buttonVariants({ variant: "ghost", size: "icon" }))} onClick={async e=>{if(e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;e.preventDefault();if(await save())router.push(`/p/${projectId}`);}}><ArrowLeft /></Link>
      <div className="min-w-0 flex-1"><h1 className="break-words text-sm font-medium">{sequence?.title ?? projectName}</h1><p className="truncate text-xs text-muted-foreground">{projectName} · {sequence?.items.length ?? 0} {(sequence?.items.length ?? 0)===1?"clip":"clips"}</p></div>
      {/* Everything about the video as a whole lives behind one menu, so the column beside
          the frame can be about whatever is selected. */}
      <Menu>
        <MenuTrigger render={<Button variant="ghost" size="sm" disabled={!sequence}><Settings2 />Video</Button>} />
        <MenuContent align="end">
          <ContextMenuItem onClick={()=>setPanel("plan")}>Plan and templates</ContextMenuItem>
          <ContextMenuItem onClick={()=>setPanel("rules")}>Rules and preferences</ContextMenuItem>
          <ContextMenuItem onClick={()=>setPanel("comment")}>Opening comment</ContextMenuItem>
          <ContextMenuItem onClick={()=>setPanel("settings")}>Video settings</ContextMenuItem>
        </MenuContent>
      </Menu>
      <Shortcuts />
      <Button variant="ghost" size="icon-sm" aria-label="Undo" title="Undo (Cmd or Ctrl + Z)" disabled={!editor.canUndo} onClick={editor.undo}><Undo2 /></Button>
      <Button variant="ghost" size="icon-sm" aria-label="Redo" title="Redo (Shift + Cmd or Ctrl + Z)" disabled={!editor.canRedo} onClick={editor.redo}><Redo2 /></Button>
      <Button variant="outline" size="sm" disabled={!dirty||saving} onClick={()=>void save()}>{saving ? <Loader2 className="motion-safe:animate-spin" /> : <Check />}{dirty ? "Save" : "Saved"}</Button>
      {download && !dirty && targetId && <a download href={clipUrl(projectId,targetId)} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}><Download />Download</a>}
      <Button size="sm" disabled={rendering||assetBusy||!hasContent} onClick={render}>{rendering ? <Loader2 className="motion-safe:animate-spin" /> : <Wand2 />}{rendering ? "Rendering…" : "Render"}</Button>
    </Glass>
    <Button className="mx-4 mt-3 self-start xl:hidden" variant="outline" size="sm" aria-expanded={assetPanelOpen} onClick={()=>setAssetPanelOpen(!assetPanelOpen)}><FolderOpen />{assetPanelOpen ? "Hide assets" : "Browse assets"}</Button>
    <fieldset disabled={assetBusy} aria-busy={assetBusy} className={`flex min-h-0 min-w-0 flex-1 flex-col gap-5 px-4 pt-4 pb-5 lg:flex-row ${assetBusy ? "cursor-progress" : ""}`}>
      <aside aria-label="Asset browser" {...libraryDropHandlers} className={`${assetPanelOpen ? "block" : "hidden xl:block"} w-full min-w-0 shrink-0 rounded-3xl lg:w-[320px] lg:overflow-y-auto lg:pr-1 ${libraryDrag ? "outline-2 outline-dashed outline-offset-2 outline-primary" : ""}`}>
        <MediaBrowser projectId={projectId} edl={savedEdl} focus={assetFocus} beforeImport={save} afterImport={editor.reload} onBusy={setAssetBusy} onPreview={()=>player.current?.pause()} canPlace={!!sequence} onVideo={id=>{const name=appendVideo(id);if(name)notify(`${name} added to the end.`);}} onLibraryVideo={id=>void placeLibraryVideo(id).catch(error=>setActionError((error as Error).message))} onVideoLayer={id=>{const name=appendVideo(id,true);if(name)notify(`${name} added over the playhead.`);}} videoAction="Add to timeline" onPlace={(asset,mode)=>{const name=placeAsset(asset,mode);if(name)notify(`${name} added at the playhead.`);}} onRemoveVideo={mediaId=>{const name=edl.media.find(m=>m.id===mediaId)?.name ?? "That source";if(dispatched([{type:"media.remove",mediaId}]))notify(`${name} removed from the project.`);}}
          replace={replaceable} onReplace={(id,kind)=>{if(!item)return;if(kind==="video")replaceMedia(item.id,id);else void replaceAsset(item.id,id,0);}} />
      </aside>
      <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
        <div ref={previewArea} className="flex h-[55dvh] min-h-64 items-center justify-center overflow-hidden lg:h-auto lg:min-h-0 lg:flex-1">
          {!sequence?.items.length ? <div {...frameDropHandlers} className={`flex h-full w-full flex-col items-center justify-center gap-4 rounded-2xl border border-dashed p-6 text-center transition-colors ${canvasDrop ? "border-primary bg-primary/10" : "border-white/15 bg-black/30"}`}><Square aria-hidden className="size-9 text-muted-foreground" /><h2 className="text-xl font-medium">Your empty canvas</h2><p className="max-w-sm text-sm leading-relaxed text-muted-foreground">{canvasDrop ? "Drop it here to start your video." : "Drag files or assets straight in, or start with a title, image, or audio. Everything is editable here."}</p><div className="flex flex-wrap justify-center gap-2"><Button variant="outline" onClick={()=>setAssetPanelOpen(true)}><FolderOpen />Browse assets</Button><Button onClick={()=>sequence ? addCanvas() : newSequence()}><Plus />{sequence ? "Add a blank scene" : "Create a video"}</Button></div></div> : <div {...frameDropHandlers} onPointerDown={pickOnCanvas} className="relative shrink-0 select-none" style={previewSize.width ? previewSize : {aspectRatio:`${output.width} / ${output.height}`,height:"100%",maxWidth:"100%"}}>
            {canvasDrop && <div aria-hidden className="pointer-events-none absolute inset-0 z-20 rounded-2xl border-2 border-dashed border-primary/80 bg-black/35">
              <CanvasGrid />
              <span className="absolute size-16 -translate-x-1/2 -translate-y-1/2 rounded-xl border-2 border-primary bg-primary/20" style={{left:`${canvasDrop.x*100}%`,top:`${canvasDrop.y*100}%`}} />
              <span className="absolute inset-x-0 bottom-4 text-center text-xs font-medium text-white">Drop to place it here</span>
            </div>}
            {previewProps ? <Player ref={player} component={SequenceComposition} inputProps={previewProps} playbackRate={rate} durationInFrames={allocation!.duration} fps={output.fps} compositionWidth={output.width} compositionHeight={output.height} spaceKeyToPlayOrPause={false} clickToPlay={false} acknowledgeRemotionLicense className="overflow-hidden rounded-2xl border border-border bg-black" style={{width:"100%",height:"100%"}} /> : null}
            {canvasSelected && !playing && item && sequence && (item.mediaId || clip.edits.some(e=>e.type==="text"||e.type==="image") || (clip.words.length>0&&clip.captions.preset!=="none")) && <CanvasSelection key={item.id} item={item} sequence={sequence} dispatch={dispatch} onPreview={setCanvasPreview} selectedEdit={selected} onSelectEdit={index=>{setSelected(index);setTab("edit");}} onSelectCaptions={()=>setTab("captions")} />}
          </div>}
        </div>
        {/* The selected clip's controls, under the frame rather than over it: the picture is
            what the layers are dragged on, and a bar floating there covered a third of it —
            including the captions and any overlay sitting low in the shot. The row keeps its
            height with nothing selected, so picking a clip never resizes the preview. */}
        {!!sequence?.items.length && <div className={TOOLBAR_ROW}>
          {canvasSelected && item && sequence
            ? <ClipToolbar key={`toolbar-${item.id}`} item={item} clip={clip} palette={palette} span={toolbarSpan}
              canDetach={!!item.mediaId && !item.muted && !item.hidden}
              onChange={update}
              onMute={muted=>dispatch([{type:"item.place",sequenceId:sequence.id,itemId:item.id,patch:{muted},before:{muted:item.muted??false}}])}
              onSplit={()=>splitAtPlayhead()} onDuplicate={()=>duplicateSelected()} onDetachAudio={()=>detachAudio()} onAddText={addText}
              onRemove={()=>{if(dispatched([{type:"item.remove",sequenceId:sequence.id,itemId:item.id}])){setActiveItemId("");notify(`${clip.title} removed from the timeline.`,"change");}}} />
            : <p className="px-2 text-xs text-muted-foreground">Pick a clip on the frame or the timeline to edit it.</p>}
        </div>}
        <Card className="min-h-0 max-h-[45dvh] min-w-0 shrink-0 overflow-hidden py-3"><CardContent className="flex min-h-0 flex-col gap-3 overflow-hidden px-4">
          {sequence && <SequenceTimeline projectId={projectId} sequence={sequence} selectedId={item?.id} dispatch={dispatch} onSeek={seek} playing={playing} onPlayToggle={()=>{if(playing)player.current?.pause();else player.current?.play();}} rate={rate} onRateChange={setRate} media={edl.media} mediaUrls={mediaUrls} assetUrls={assetUrls} selectedEdit={selected} onSelectEdit={index=>{setSelected(index);setTab("edit");}} onDropMedia={(id,at,layer)=>appendVideo(id,layer>0,{at,layer})} onDropAsset={(id,at,layer)=>void dropAsset(id,at,layer)} onDropFiles={(files,at,layer)=>dropFiles(files,{at,layer})} onDropLocalFile={(file,kind,at,layer)=>dropLocalFile(file,kind,{at,layer})} onDropSearchHit={(hit,at,layer)=>dropSearchHit(hit,{at,layer})} onReplaceMedia={replaceMedia} onReplaceAsset={(itemId,assetId,editIndex)=>void replaceAsset(itemId,assetId,editIndex)} onSplit={splitAtPlayhead} onDuplicate={duplicateSelected} onDetachAudio={detachAudio} chat={chat} onAskAgent={id=>{setActiveItemId(id);setCanvasSelected(true);}} onNotify={notify} onSelect={(id,t)=>{setActiveItemId(id);setCanvasSelected(true);player.current?.pause();if(t!==null)seek(t);resetSelection();}} />}
          {/* Everything a video can be given, in one row under the timeline it lands on.
              Split and duplicate are not here: they act on the selection, so they live with
              the selection in the bar under the frame. The second group does act on the
              picked clip, which is why it is named after it and only appears with one. */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <div role="group" aria-labelledby={addGroupId} className="flex flex-wrap items-center gap-1.5">
              <span id={addGroupId} className="pr-0.5 text-[11px] font-medium text-muted-foreground">Add</span>
              <Button size="xs" variant="outline" disabled={!sequence} aria-label="Add text" title="A line of its own, on the track the other titles are on" onClick={()=>addEdit("text")}><Type />Text</Button>
              <Button size="xs" variant="outline" disabled={!sequence} aria-label="Add an image" title="Pictures in your project, your library and online" onClick={()=>browseAssets("image")}><ImagePlus />Image</Button>
              {/* Sound is not something a shot carries: it goes onto the audio track under the
                  picture, where it can span the cuts it plays across. */}
              <Button size="xs" variant="outline" disabled={!sequence} aria-label="Add music" title="Music and sound effects, on their own track under the picture" onClick={()=>browseAssets("audio")}><Music2 />Music</Button>
              <Button size="xs" variant="outline" disabled={!sequence} aria-label="Add a blank scene" title="An empty scene on a new track, ready for a title, image or sound" onClick={()=>addCanvas()}><Square />Blank scene</Button>
            </div>
            {canvasSelected&&item&&<div role="group" aria-labelledby={clipGroupId} className="flex flex-wrap items-center gap-1.5">
              <span id={clipGroupId} className="pr-0.5 text-[11px] font-medium text-muted-foreground">This clip</span>
              {([["punch","Punch-in","Push in on the picture at the playhead"],["emphasis","Emphasis","Colour the words being said at the playhead"],["silence","Silence cut","Take out a pause at the playhead"]] as const).map(([kind,label,hint])=>
                <Button key={kind} size="xs" variant="outline" aria-label={`Add ${label.toLowerCase()}`} title={hint} onClick={()=>addEdit(kind)}>{label}</Button>)}
            </div>}
          </div>
        </CardContent></Card>
      </section>
      <aside aria-label="Editing properties" className="flex w-full min-h-0 shrink-0 flex-col gap-3 lg:w-[340px] lg:overflow-y-auto lg:pr-1">
        <Card className="shrink-0 p-4"><EditorStatus editor={editor} />{actionError&&<p role="alert" className="text-sm text-destructive">{actionError}</p>}<AgentEditor projectId={projectId} controller={chat} selection={item?{id:item.id,title:clip.title}:null} />
          {picked&&<><Button variant="outline" aria-expanded={propertiesOpen} onClick={()=>setPropertiesOpen(!propertiesOpen)}>{propertiesOpen?"Close properties":"All item properties"}</Button>{propertiesOpen&&<EditorProperties key={clip.id} clip={clip} edl={inspectEdl} validationEdl={edl} joint={joint} motion={motion} mapOperations={mapOperations} dispatch={dispatch} onApplied={()=>setPropertiesOpen(false)} />}</>}
        </Card>
        {!picked&&<p className="shrink-0 rounded-2xl border border-dashed border-white/15 p-4 text-xs leading-relaxed text-muted-foreground"><MousePointerClick aria-hidden className="mb-2 size-4" /><br />Nothing picked. A clip&apos;s properties appear here, and its everyday controls in the bar under the frame. The video as a whole — plan, templates, rules, format — is under <strong className="font-medium text-foreground">Video</strong> at the top.</p>}
        {picked&&<>
          {sequence&&item&&<Disclosure className="shrink-0" heading="h2" summary="Position & audio"><LayerInspector key={`placement-${item.id}`} sequence={sequence} item={item} dispatch={dispatch} /></Disclosure>}
          {sequence&&item&&<Disclosure className="shrink-0" heading="h2" open={!!item.keyframes?.length} summary="Motion" aside={item.keyframes?.length?`${item.keyframes.length} keyframes`:undefined}><MotionInspector key={`motion-${item.id}`} sequence={sequence} item={item} dispatch={dispatch} onSeek={seek} /></Disclosure>}
          {sequence&&item&&<Disclosure className="shrink-0" heading="h2" summary="Trim & split"><SceneBounds key={item.id} clip={clip} sourceDuration={source?.durationSec} fps={output.fps} onChange={(start,end)=>{
            const duration=end-start;
            const fullCanvasEdit=!source && clip.edits.length===1 && clip.edits[0].t===0 && Math.abs(clip.edits[0].d-(clip.end-clip.start))<.01;
            update({...clip,start,end,...(fullCanvasEdit?{edits:[{...clip.edits[0],d:duration}]}:{})});
          }} onSplit={at=>dispatch([{type:"item.split",sequenceId:sequence.id,itemId:item.id,at,newItemId:uid("i")}])}
            onSlip={delta=>{
              try { const ops=buildTimelineSlip(sequence,item.id,delta,edl.media); if(ops.length)dispatch(ops); }
              catch(error){ notify((error as Error).message,"error"); }
            }} /></Disclosure>}
          <Card className="shrink-0 p-4"><Tabs value={tab} onValueChange={v=>setTab(v as typeof tab)}><TabsList className="w-full"><TabsTrigger value="captions" className="flex-1">Captions</TabsTrigger><TabsTrigger value="overlays" className="flex-1">Add</TabsTrigger><TabsTrigger value="edit" className="flex-1" disabled={selected===null}>Selected</TabsTrigger></TabsList>
            <TabsContent value="captions" className="pt-4"><CaptionControls value={clip.captions} onChange={captions=>update({...clip,captions})} /></TabsContent>
            <TabsContent value="overlays" className="pt-4"><OverlayEditor key={clip.id} onPlaceBed={placeMusicBed} onAddText={addText} projectId={projectId} mediaId={savedEdl.media.some(m=>m.id===item?.mediaId) ? item?.mediaId ?? undefined : undefined} canCapture={!!source} clip={clip} atSec={playheadInSource} onChange={edits=>update({...clip,edits})} /></TabsContent>
            <TabsContent value="edit" className="pt-4">{selected!==null&&clip.edits[selected]?<ClipInspector projectId={projectId} edit={clip.edits[selected]} onChange={edit=>update({...clip,edits:clip.edits.map((e,i)=>i===selected?edit:e)})} onRemove={()=>{update({...clip,edits:clip.edits.filter((_,i)=>i!==selected)});setSelected(null);setTab("captions");}} />:<p className="text-xs text-muted-foreground">Pick a block on the timeline.</p>}</TabsContent>
          </Tabs></Card>
          <Transcript clip={clip} map={map} itemOffset={itemOffset} onSeek={seek} onTrimStart={word=>update({...clip,start:clip.start+word.t})} />
        </>}
      </aside>
    </fieldset>

    <Dialog open={panel !== null} onOpenChange={open=>{if(!open)setPanel(null);}}>
      <DialogContent className="max-h-[85dvh] w-[min(38rem,92vw)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{panel==="plan"?"Plan and templates":panel==="rules"?"Rules and preferences":panel==="comment"?"Opening comment":"Video settings"}</DialogTitle>
        </DialogHeader>
        {panel==="plan"&&sequence&&<PlanPanel projectId={projectId} edl={edl} sequenceId={activeSequenceId} templates={templateOptions} dispatch={dispatch} seek={seek} beforeRun={save} afterRun={editor.reload}><TemplatePanel projectId={projectId} sequenceId={activeSequenceId} beforeApply={save} afterApply={editor.reload} onBusy={setAssetBusy} /></PlanPanel>}
        {panel==="rules"&&<RulesPanel projectId={projectId} sequenceId={sequence ? activeSequenceId : undefined} beforeApply={save} afterApply={editor.reload} />}
        {panel==="comment"&&sequence&&<CommentPanel projectId={projectId} sequenceId={activeSequenceId} beforeApply={save} afterApply={editor.reload} />}
        {panel==="settings"&&sequence&&<SequenceSettings key={sequence.id} sequence={sequence} dispatch={dispatch} />}
      </DialogContent>
    </Dialog>
  </main></PlayheadProvider>;
}

/**
 * The transcript doubles as a scrub bar, so it follows the playhead — but only the word
 * that lights up changes, so it subscribes to the index rather than to every frame.
 */
function Transcript({ clip, map, itemOffset, onSeek, onTrimStart }: {
  clip: Clip; map: ReturnType<typeof buildTimeMap>; itemOffset: number;
  onSeek: (seconds: number) => void; onTrimStart: (word: Clip["words"][number]) => void;
}) {
  const times = useMemo(() => clip.words.map(word => srcToOut(map, word.t)), [clip.words, map]);
  const active = usePlayheadSelector(seconds => {
    const local = Math.max(0, Math.min(map.duration, seconds - itemOffset));
    return times.findIndex((t, i) => local >= t && local < t + clip.words[i].d);
  });
  return <Card className="flex min-h-0 shrink-0 flex-col gap-0 py-0"><div className="px-4 py-2.5 text-xs text-muted-foreground">Transcript — click to seek</div><Separator /><ScrollArea className="h-48"><div className="flex flex-wrap gap-x-1 gap-y-1.5 p-4 text-sm leading-relaxed">{clip.words.map((word,i)=><button key={i} type="button" onClick={()=>onSeek(itemOffset+times[i])} onDoubleClick={()=>onTrimStart(word)} title={`${fmt(times[i])} — double-click to trim the start here`} className={`rounded-md px-1 outline-none hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-ring ${active===i?"bg-primary/25 text-primary":""}`}>{word.w}</button>)}{!clip.words.length&&<p className="text-xs text-muted-foreground">No transcript yet. Caption words can be edited in Properties.</p>}</div></ScrollArea></Card>;
}
/**
 * A time field that takes either — seconds, or the timecode the ruler prints.
 *
 * Seconds alone is fine for a forty-second clip and hopeless for a moment an hour and
 * three quarters into a stream: nobody knows what 6517.133 is, and typing it is how a
 * frame gets missed. `0:00:12:07` says the seventh frame of the twelfth second, which is
 * how a moment is named anywhere else in this trade. It keeps what was typed until it
 * parses, so a half-finished timecode is not thrown away mid-keystroke.
 */
function TimeField({label,value,fps,max,onChange}:{label:string;value:number;fps:number;max?:number;onChange:(seconds:number)=>void}) {
  const [draft,setDraft]=useState<string|null>(null);
  const shown=draft ?? frameLabel(value,fps);
  const parsed=draft===null?value:parseTimecode(draft,fps);
  const bad=parsed===null||parsed<0||(max!==undefined&&parsed>max+1e-6);
  return <label className="space-y-1 text-xs">{label}
    <Input required inputMode="decimal" aria-invalid={bad} value={shown}
      onChange={e=>{const next=e.target.value;setDraft(next);const seconds=parseTimecode(next,fps);if(seconds!==null&&seconds>=0&&(max===undefined||seconds<=max+1e-6))onChange(Math.round(seconds*fps)/fps);}}
      onBlur={()=>setDraft(null)} />
    {bad?<span role="alert" className="block text-[11px] text-destructive">Use seconds, m:ss, or h:mm:ss:ff.</span>:null}
  </label>;
}
function SceneBounds({clip,sourceDuration,fps,onChange,onSplit,onSlip}:{clip:Clip;sourceDuration?:number;fps:number;onChange:(start:number,end:number)=>void;onSplit:(at:number)=>void;onSlip:(delta:number)=>void}) {
  const [start,setStart]=useState(clip.start),[end,setEnd]=useState(clip.end),[base,setBase]=useState({start:clip.start,end:clip.end}),[split,setSplit]=useState(1);
  const stale=base.start!==clip.start||base.end!==clip.end;
  useEffect(()=>{if(stale&&start===base.start&&end===base.end){setStart(clip.start);setEnd(clip.end);setBase({start:clip.start,end:clip.end});}},[stale,start,end,base,clip.start,clip.end]);
  return <div className="flex min-w-0 flex-col gap-3"><p className="truncate text-xs text-muted-foreground">{clip.title}</p><form className="space-y-3" onSubmit={e=>{e.preventDefault();if(stale||end<=start)return;onChange(start,end);setBase({start,end});}}>{sourceDuration ? <div className="grid grid-cols-2 gap-3"><TimeField label="In" value={start} fps={fps} max={sourceDuration} onChange={setStart} /><TimeField label="Out" value={end} fps={fps} max={sourceDuration} onChange={setEnd} /></div> : <label className="block space-y-1 text-xs">Duration (seconds)<Input required type="number" min={0.01} step="any" value={end-start} onChange={e=>setEnd(start+Number(e.target.value))} /></label>}<Button type="submit" variant="outline" size="sm" disabled={stale||end<=start}>{sourceDuration?"Apply trim":"Apply duration"}</Button>{stale&&<><p role="status" className="text-xs text-muted-foreground">This scene changed. Your trim fields are preserved.</p><Button type="button" size="sm" variant="ghost" onClick={()=>{setStart(clip.start);setEnd(clip.end);setBase({start:clip.start,end:clip.end});}}>Load latest trim</Button></>}</form>{sourceDuration ? <div className="space-y-2">
    <p className="text-xs text-muted-foreground">Slip content <span className="tabular-nums">— footage starts at {fmt(clip.start)}</span></p>
    {/* Slipping changes what the clip shows without moving it or changing how long it runs. */}
    <div className="flex gap-2">
      <Button size="xs" variant="outline" aria-label="Show footage half a second earlier" disabled={clip.start <= 0} onClick={()=>onSlip(-0.5)}><ChevronLeft />0.5s earlier</Button>
      <Button size="xs" variant="outline" aria-label="Show footage half a second later" disabled={clip.end >= sourceDuration} onClick={()=>onSlip(0.5)}>0.5s later<ChevronRight /></Button>
    </div>
  </div> : null}<label className="space-y-1 text-xs">Split after (seconds)<Input type="number" min={0.01} step="any" value={split} onChange={e=>setSplit(Number(e.target.value))} /></label><Button variant="outline" size="sm" disabled={split<=0||split>=clip.end-clip.start} onClick={()=>onSplit(split)}><Scissors />Split scene</Button></div>;
}
