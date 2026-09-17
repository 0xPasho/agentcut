"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Player, type PlayerRef } from "@remotion/player";
import { ArrowLeft, Check, Download, FolderOpen, Loader2, Plus, Scissors, Square, Wand2 } from "lucide-react";
import { promoteClipToSequence } from "@/lib/editor/editable-timeline";
import { LayerInspector } from "./layer-inspector";
import { CanvasSelection, type CanvasPreview } from "./canvas-selection";
import { SequenceComposition } from "@/../remotion/SequenceComposition";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Card, CardContent } from "./ui/card";
import { Glass } from "./ui/glass";
import { ScrollArea } from "./ui/scroll-area";
import { Separator } from "./ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { ClipInspector } from "./clip-inspector";
import { CaptionControls } from "./caption-controls";
import { OverlayEditor } from "./overlay-editor";
import { EditorStatus } from "./editor-status";
import { EditorProperties } from "./editor-properties";
import { AgentEditor } from "./agent-editor";
import { MediaBrowser } from "./media-browser";
import { SequenceTimeline } from "./sequence-timeline";
import { SequenceSettings } from "./sequence-settings";
import { useEditor } from "@/lib/editor/use-editor";
import { patchFromClip, type EditorOperation } from "@/lib/editor/operations";
import { assetEdit } from "@/lib/editor/asset-edit";
import { api, assetUrl, clipUrl, type AssetSummary } from "@/lib/client";
import { buildTimeMap, srcToOut } from "@/lib/timeline";
import { sequenceFrames } from "@/lib/sequences";
import { fmt } from "@/lib/transcript";
import { Clip as ClipSchema, type Clip, type Edit, type Edl } from "@/lib/edl";

const uid = (prefix: string) => `${prefix}_${crypto.randomUUID().slice(0,8)}`;
// Display-only fallback for an empty timeline. Never saved as source footage.
const EMPTY = ClipSchema.parse({ id: "empty", title: "Empty canvas", start: 0, end: 5, captions: { preset: "none" } });
const NEW_EDIT: Record<string, (t: number) => Edit> = {
  silence: t => ({ type: "silence", t, d: 0.4 }),
  punch: t => ({ type: "punch", t, d: 1.2, scale: 1.12 }),
  emphasis: t => ({ type: "emphasis", t, d: 1, words: [], color: "#ffe600" }),
  text: t => ({ type: "text", t, d: 3, text: "New title", position: "top", style: "card" }),
};

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
  const { save, dirty, saving } = editor;
  const [canvasSelected,setCanvasSelected]=useState(false),[playing,setPlaying]=useState(false);
  const [canvasPreview,setCanvasPreview]=useState<CanvasPreview>(null);
  const [activeItemId, setActiveItemId] = useState("");
  const sequence = edl.sequences.find(s => s.id === activeSequenceId);
  const item = sequence?.items.find(i => i.id === activeItemId) ?? sequence?.items[0];
  const clip = item?.clip ?? EMPTY;
  const hasContent = !!item;
  const output = sequence?.output ?? edl.output;
  const source = edl.media.find(m => m.id === item?.mediaId) ?? null;
  const [actionError, setActionError] = useState<string | null>(null);
  const [assetBusy, setAssetBusy] = useState(false);
  const [assetPanelOpen, setAssetPanelOpen] = useState(false);
  const [propertiesOpen, setPropertiesOpen] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [currentSec, setCurrentSec] = useState(0);
  const [rendering, setRendering] = useState(false);
  const [download, setDownload] = useState(false);
  const [tab, setTab] = useState<"captions" | "overlays" | "edit">("captions");
  const player = useRef<PlayerRef>(null);
  const previewArea = useRef<HTMLDivElement>(null);
  const [previewSize,setPreviewSize] = useState({width:0,height:0});
  useEffect(()=>{
    const el=previewArea.current;if(!el)return;
    const observer=new ResizeObserver(([entry])=>{
      const width=Math.min(entry.contentRect.width,entry.contentRect.height*output.width/output.height);
      setPreviewSize({width,height:width*output.height/output.width});
    });
    observer.observe(el);return()=>observer.disconnect();
  },[output.width,output.height]);
  const map = useMemo(() => buildTimeMap(clip), [clip]);
  const allocation = useMemo(() => sequence ? sequenceFrames(sequence) : null, [sequence]);
  const itemOffset = (allocation?.items.find(i => i.item.id === item?.id)?.from ?? 0) / output.fps;
  const localSec = Math.max(0, Math.min(map.duration, currentSec-itemOffset));
  const targetId = sequence?.id ?? clipId;

  useEffect(() => {
    const p = player.current; if (!p) return;
    const onFrame = () => setCurrentSec(p.getCurrentFrame()/output.fps);
    const onPlay=()=>setPlaying(true),onPause=()=>setPlaying(false);
    p.addEventListener("frameupdate", onFrame);p.addEventListener("play",onPlay);p.addEventListener("pause",onPause);
    return () => {p.removeEventListener("frameupdate",onFrame);p.removeEventListener("play",onPlay);p.removeEventListener("pause",onPause);};
  }, [output.fps, !!sequence?.items.length]);
  useEffect(() => {
    let disposed = false;
    const refresh = async () => { try {
      const p = await api.getProject(projectId);
      if (!disposed) { setDownload(p.revision === editor.snapshot!.revision && !!targetId && p.rendered.includes(targetId)); setRendering(p.job?.kind === "render" && (p.job.status === "running" || p.job.status === "queued")); }
    } catch { /* keep the editor usable during a transient failure */ } };
    void refresh(); const timer = setInterval(refresh, 1500); return () => { disposed = true; clearInterval(timer); };
  }, [projectId, targetId, editor.snapshot!.revision]);
  const seek = useCallback((seconds: number) => { player.current?.seekTo(Math.round(seconds*output.fps)); setCurrentSec(seconds); },[output.fps]);
  const playheadInSource = useMemo(() => {
    const span = map.spans.find(s => localSec >= s.outStart && localSec < s.outStart+s.srcEnd-s.srcStart);
    return Math.max(0, Math.min(span ? span.srcStart+localSec-span.outStart : localSec, clip.end-clip.start-0.01));
  }, [map, localSec, clip.start, clip.end]);
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
    const id = uid("s"); dispatch([{ type: "sequence.add", sequence: { id, title: `Video ${edl.sequences.length+1}`, output: { ...edl.output }, items: [] } }]);
    setActiveSequenceId(id); setActiveItemId(""); seek(0); resetSelection();
  };
  const topLayer = () => Math.max(0,...(sequence?.items.map(i=>i.layer ?? 0) ?? []))+1;
  const mainEnd = () => Math.max(0,...(allocation?.items.filter(i=>(i.item.layer ?? 0)===0).map(i=>i.from+i.duration) ?? []))/output.fps;
  const addCanvas = (edit?: Edit, title = "Canvas layer", placement?:{at:number;layer:number}) => {
    if (!sequence) return;
    const id = uid("layer"), duration = edit ? edit.d : 5;
    const ops:EditorOperation[]=[{type:"item.add",sequenceId:sequence.id,item:{id,mediaId:null,at:placement?.at ?? currentSec,layer:placement?.layer ?? topLayer(),clip:ClipSchema.parse({id,title,start:0,end:duration,captions:{preset:"none"},edits:edit ? [{...edit,t:0}] : []})}}];
    if(placement?.layer===0)ops.push({type:"item.reorder",sequenceId:sequence.id,itemId:id,layer:0,index:allocation!.items.filter(i=>(i.item.layer??0)===0).sort((a,b)=>a.from-b.from).filter(i=>placement.at>=(i.from+i.duration/2)/output.fps).length});
    dispatch(ops);
    setActiveItemId(id); setCanvasSelected(true); player.current?.pause(); if(placement)seek(placement.at); resetSelection();
    if(edit) { setSelected(0); setTab("edit"); }
  };
  const appendVideo = (mediaId: string, overlay = false, drop?:{at:number;layer:number}) => {
    setActionError(null);
    const media = edl.media.find(m=>m.id===mediaId) ?? (mediaId === "primary_source" && edl.source ? {...edl.source,id:mediaId,name:projectName} : undefined);
    if (!media || !sequence) return setActionError("Choose a timeline and an available source.");
    const ops: EditorOperation[] = [];
    if (!edl.media.some(m=>m.id===media.id)) ops.push({type:"media.add",media});
    const id=uid("i"), at=drop?.at ?? (overlay ? currentSec : mainEnd());
    ops.push({type:"item.add",sequenceId:sequence.id,item:{id,mediaId:media.id,at,layer:drop?.layer ?? (overlay ? topLayer() : 0),
      ...(overlay ? {transform:{x:65,y:5,width:30,height:30,rotation:0,opacity:1}} : {}),
      clip:ClipSchema.parse({id,title:media.name,start:0,end:media.durationSec,captions:{preset:"none"}})}});
    if(drop?.layer===0){
      const index=allocation!.items.filter(i=>(i.item.layer??0)===0).sort((a,b)=>a.from-b.from).filter(i=>drop.at>=(i.from+i.duration/2)/output.fps).length;
      ops.push({type:"item.reorder",sequenceId:sequence.id,itemId:id,layer:0,index});
    }
    dispatch(ops); setActiveItemId(id); setCanvasSelected(true); player.current?.pause(); seek(at); resetSelection();
  };
  const placeAsset = (asset: AssetSummary, mode?: "music" | "sfx", placement?:{at:number;layer:number}) => {
    const duration = asset.kind === "audio" && mode !== "sfx" ? Math.max(5,(allocation?.duration ?? 0)/output.fps-(placement?.at??currentSec)) : 3;
    addCanvas(assetEdit(asset,0,duration,mode),asset.name,placement);
  };
  const dropAsset = async(assetId:string,at:number,layer:number)=>{
    try {
      const lists=await Promise.all(["image","audio"].map(kind=>api.editorTool<AssetSummary[]>(projectId,{tool:"assets.list",kind})));
      const asset=lists.flat().find(a=>a.id===assetId);if(!asset)throw new Error("This asset is no longer available.");
      placeAsset(asset,asset.kind==="audio"?"music":undefined,{at,layer});
    }catch(error){setActionError((error as Error).message);}
  };
  const render = async () => {
    setActionError(null); if(!targetId) return;
    try { if(!(await save())) return; const p=await api.getProject(projectId); await api.render(projectId,[targetId],p.revision); setRendering(true); }
    catch(e){setActionError((e as Error).message);}
  };
  const addEdit = (kind: string) => {
    if(kind === "text") { addCanvas(NEW_EDIT.text(0),"Title"); return; }
    if(!sequence || !item) return;
    dispatch([{type:"item.edit.add",sequenceId:sequence.id,itemId:item.id,edit:NEW_EDIT[kind](playheadInSource)}]);
    setSelected(clip.edits.length);setTab("edit");
  };
  const inspectEdl: Edl = {...edl,output};


  if(!sequence && activeSequenceId) return <main className="p-8"><h1 className="mb-4 text-xl font-medium">This video is no longer available</h1><Button render={<Link href={`/p/${projectId}`} />}>Back to project</Button></main>;
  return <main className="flex min-h-dvh flex-col lg:h-dvh lg:min-h-0 lg:overflow-hidden">
    <Glass shape="panel" className="mx-4 mt-4 flex shrink-0 flex-wrap items-center gap-3 px-4 py-2.5 lg:rounded-full">
      <Button aria-label="Back to project" variant="ghost" size="icon" render={<Link href={`/p/${projectId}`} />} onClick={async e=>{if(e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;e.preventDefault();if(await save())router.push(`/p/${projectId}`);}}><ArrowLeft /></Button>
      <div className="min-w-0 flex-1"><h1 className="break-words text-sm font-medium">{sequence?.title ?? projectName}</h1><p className="truncate text-xs text-muted-foreground">{projectName} · {sequence?.items.length ?? 0} {(sequence?.items.length ?? 0)===1?"clip":"clips"}</p></div>
      <Button variant="outline" size="sm" disabled={!dirty||saving} onClick={()=>void save()}>{saving ? <Loader2 className="motion-safe:animate-spin" /> : <Check />}{dirty ? "Save" : "Saved"}</Button>
      {download && !dirty && targetId && <Button variant="outline" size="sm" render={<a download href={clipUrl(projectId,targetId)} />}><Download />Download</Button>}
      <Button size="sm" disabled={rendering||assetBusy||!hasContent} onClick={render}>{rendering ? <Loader2 className="motion-safe:animate-spin" /> : <Wand2 />}{rendering ? "Rendering…" : "Render"}</Button>
    </Glass>
    <Button className="mx-4 mt-3 self-start xl:hidden" variant="outline" size="sm" aria-expanded={assetPanelOpen} onClick={()=>setAssetPanelOpen(!assetPanelOpen)}><FolderOpen />{assetPanelOpen ? "Hide assets" : "Browse assets"}</Button>
    <fieldset disabled={assetBusy} className="flex min-h-0 min-w-0 flex-1 flex-col gap-5 px-4 pt-4 pb-5 lg:flex-row">
      <aside aria-label="Asset browser" className={`${assetPanelOpen ? "block" : "hidden xl:block"} w-full min-w-0 shrink-0 lg:w-[320px] lg:overflow-y-auto lg:pr-1`}>
        <MediaBrowser projectId={projectId} edl={savedEdl} beforeImport={save} afterImport={editor.reload} onBusy={setAssetBusy} onPreview={()=>player.current?.pause()} canPlace={!!sequence} onVideo={id=>appendVideo(id)} onVideoLayer={id=>appendVideo(id,true)} videoAction="Add to timeline" onPlace={placeAsset} onRemoveVideo={mediaId=>{if(confirm("Remove this source from the project?"))dispatch([{type:"media.remove",mediaId}]);}} />
      </aside>
      <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
        <div ref={previewArea} className="flex h-[55dvh] min-h-64 items-center justify-center overflow-hidden lg:h-auto lg:min-h-0 lg:flex-1">
          {!sequence?.items.length ? <div className="flex h-full w-full flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-white/15 bg-black/30 p-6 text-center"><Square aria-hidden className="size-9 text-muted-foreground" /><h2 className="text-xl font-medium">Your empty canvas</h2><p className="max-w-sm text-sm leading-relaxed text-muted-foreground">Add as many videos as you need, or start with a title, image, or audio. Everything is editable here.</p><div className="flex flex-wrap justify-center gap-2"><Button variant="outline" onClick={()=>setAssetPanelOpen(true)}><FolderOpen />Browse assets</Button><Button onClick={()=>sequence ? addCanvas() : newSequence()}><Plus />{sequence ? "Add blank layer" : "Create a video"}</Button></div></div> : <div className="relative shrink-0" style={previewSize.width ? previewSize : {aspectRatio:`${output.width} / ${output.height}`,height:"100%",maxWidth:"100%"}}>
            {sequence ? <Player ref={player} component={SequenceComposition} inputProps={{sequence:canvasPreview ? {...sequence,items:sequence.items.map(i=>i.id===canvasPreview.id?{...i,transform:canvasPreview.transform}:i)} : sequence,media:edl.media,mediaUrls,assetUrls,assetBase:`/api/projects/${projectId}/asset/`}} durationInFrames={allocation!.duration} fps={output.fps} compositionWidth={output.width} compositionHeight={output.height} controls acknowledgeRemotionLicense className="overflow-hidden rounded-2xl border border-border bg-black" style={{width:"100%",height:"100%"}} /> : null}
            {canvasSelected && !playing && item && sequence && (item.mediaId || clip.edits.some(e=>e.type==="text"||e.type==="image") || (clip.words.length>0&&clip.captions.preset!=="none")) && <CanvasSelection key={item.id} item={item} sequence={sequence} currentSec={currentSec} dispatch={dispatch} onPreview={setCanvasPreview} />}
          </div>}
        </div>
        <Card className="min-h-0 max-h-[45dvh] min-w-0 shrink-0 overflow-hidden py-3"><CardContent className="flex min-h-0 flex-col gap-3 overflow-hidden px-4">
          {sequence && <SequenceTimeline sequence={sequence} selectedId={item?.id} dispatch={dispatch} currentSec={currentSec} onSeek={seek} onBlank={()=>addCanvas()} media={edl.media} mediaUrls={mediaUrls} selectedEdit={selected} onSelectEdit={index=>{setSelected(index);setTab("edit");}} onDropMedia={(id,at,layer)=>appendVideo(id,layer>0,{at,layer})} onDropAsset={(id,at,layer)=>void dropAsset(id,at,layer)} onSelect={(id,t)=>{setActiveItemId(id);setCanvasSelected(true);player.current?.pause();seek(t);resetSelection();}} />}
          <div className="flex flex-wrap items-center gap-2"><Button size="xs" variant="outline" disabled={!sequence} onClick={()=>addEdit("text")}><Plus />Title</Button>{hasContent&&<details className="text-xs"><summary className="cursor-pointer rounded-full px-3 py-2 text-muted-foreground">Clip effects</summary><div className="flex flex-wrap gap-2 py-2">{["silence","punch","emphasis"].map(kind=><Button key={kind} size="xs" variant="outline" onClick={()=>addEdit(kind)}><Plus />{kind}</Button>)}</div></details>}</div>
        </CardContent></Card>
      </section>
      <aside aria-label="Editing properties" className="flex w-full min-h-0 shrink-0 flex-col gap-3 lg:w-[340px] lg:overflow-y-auto lg:pr-1">
        <Card className="shrink-0 p-4"><EditorStatus editor={editor} />{actionError&&<p role="alert" className="text-sm text-destructive">{actionError}</p>}<AgentEditor projectId={projectId} beforeRun={save} />
          {hasContent&&<><Button variant="outline" aria-expanded={propertiesOpen} onClick={()=>setPropertiesOpen(!propertiesOpen)}>{propertiesOpen?"Close properties":"All item properties"}</Button>{propertiesOpen&&<EditorProperties key={clip.id} clip={clip} edl={inspectEdl} validationEdl={edl} mapOperations={mapOperations} dispatch={dispatch} onApplied={()=>setPropertiesOpen(false)} />}</>}
        </Card>
        {sequence&&<details className="shrink-0 rounded-2xl border border-border bg-card p-4"><summary className="cursor-pointer text-sm font-medium">Video settings</summary><div className="mt-3"><SequenceSettings key={sequence.id} sequence={sequence} dispatch={dispatch} /></div></details>}
        {hasContent&&<>
          {sequence&&item&&<details className="shrink-0 rounded-2xl border border-border bg-card p-4"><summary className="cursor-pointer text-sm font-medium">Position & audio</summary><div className="mt-3"><LayerInspector key={`placement-${item.id}`} sequence={sequence} item={item} dispatch={dispatch} /></div></details>}
          {sequence&&item&&<details className="shrink-0 rounded-2xl border border-border bg-card p-4"><summary className="cursor-pointer text-sm font-medium">Trim & split</summary><div className="mt-3"><SceneBounds key={item.id} clip={clip} sourceDuration={source?.durationSec} onChange={(start,end)=>{
            const duration=end-start;
            const fullCanvasEdit=!source && clip.edits.length===1 && clip.edits[0].t===0 && Math.abs(clip.edits[0].d-(clip.end-clip.start))<.01;
            update({...clip,start,end,...(fullCanvasEdit?{edits:[{...clip.edits[0],d:duration}]}:{})});
          }} onSplit={at=>dispatch([{type:"item.split",sequenceId:sequence.id,itemId:item.id,at,newItemId:uid("i")}])} /></div></details>}
          <Card className="shrink-0 p-4"><Tabs value={tab} onValueChange={v=>setTab(v as typeof tab)}><TabsList className="w-full"><TabsTrigger value="captions" className="flex-1">Captions</TabsTrigger><TabsTrigger value="overlays" className="flex-1">Add</TabsTrigger><TabsTrigger value="edit" className="flex-1" disabled={selected===null}>Selected</TabsTrigger></TabsList>
            <TabsContent value="captions" className="pt-4"><CaptionControls value={clip.captions} onChange={captions=>update({...clip,captions})} /></TabsContent>
            <TabsContent value="overlays" className="pt-4"><OverlayEditor key={clip.id} projectId={projectId} mediaId={savedEdl.media.some(m=>m.id===item?.mediaId) ? item?.mediaId ?? undefined : undefined} canCapture={!!source} clip={clip} atSec={playheadInSource} onChange={edits=>update({...clip,edits})} /></TabsContent>
            <TabsContent value="edit" className="pt-4">{selected!==null&&clip.edits[selected]?<ClipInspector projectId={projectId} edit={clip.edits[selected]} onChange={edit=>update({...clip,edits:clip.edits.map((e,i)=>i===selected?edit:e)})} onRemove={()=>{update({...clip,edits:clip.edits.filter((_,i)=>i!==selected)});setSelected(null);setTab("captions");}} />:<p className="text-xs text-muted-foreground">Pick a block on the timeline.</p>}</TabsContent>
          </Tabs></Card>
          <Card className="flex min-h-0 shrink-0 flex-col gap-0 py-0"><div className="px-4 py-2.5 text-xs text-muted-foreground">Transcript — click to seek</div><Separator /><ScrollArea className="h-48"><div className="flex flex-wrap gap-x-1 gap-y-1.5 p-4 text-sm leading-relaxed">{clip.words.map((word,i)=>{const t=srcToOut(map,word.t);return <button key={i} type="button" onClick={()=>seek(itemOffset+t)} onDoubleClick={()=>update({...clip,start:clip.start+word.t})} title={`${fmt(t)} — double-click to trim the start here`} className={`rounded-md px-1 outline-none hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-ring ${localSec>=t&&localSec<t+word.d?"bg-primary/25 text-primary":""}`}>{word.w}</button>;})}{!clip.words.length&&<p className="text-xs text-muted-foreground">No transcript yet. Caption words can be edited in Properties.</p>}</div></ScrollArea></Card>
        </>}
      </aside>
    </fieldset>
  </main>;
}
function SceneBounds({clip,sourceDuration,onChange,onSplit}:{clip:Clip;sourceDuration?:number;onChange:(start:number,end:number)=>void;onSplit:(at:number)=>void}) {
  const [start,setStart]=useState(clip.start),[end,setEnd]=useState(clip.end),[base,setBase]=useState({start:clip.start,end:clip.end}),[split,setSplit]=useState(1);
  const stale=base.start!==clip.start||base.end!==clip.end;
  useEffect(()=>{if(stale&&start===base.start&&end===base.end){setStart(clip.start);setEnd(clip.end);setBase({start:clip.start,end:clip.end});}},[stale,start,end,base,clip.start,clip.end]);
  return <Card className="shrink-0 gap-3 p-4"><h2 className="text-sm font-medium">{sourceDuration ? "Selected video" : "Selected canvas scene"}</h2><p className="truncate text-xs text-muted-foreground">{clip.title}</p><form className="space-y-3" onSubmit={e=>{e.preventDefault();if(stale||end<=start)return;onChange(start,end);setBase({start,end});}}>{sourceDuration ? <div className="grid grid-cols-2 gap-3"><label className="space-y-1 text-xs">In (seconds)<Input required type="number" min={0} max={sourceDuration} step="any" value={start} onChange={e=>setStart(Number(e.target.value))} /></label><label className="space-y-1 text-xs">Out (seconds)<Input required type="number" min={0} max={sourceDuration} step="any" value={end} onChange={e=>setEnd(Number(e.target.value))} /></label></div> : <label className="block space-y-1 text-xs">Duration (seconds)<Input required type="number" min={0.01} step="any" value={end-start} onChange={e=>setEnd(start+Number(e.target.value))} /></label>}<Button type="submit" variant="outline" size="sm" disabled={stale||end<=start}>{sourceDuration?"Apply trim":"Apply duration"}</Button>{stale&&<><p role="status" className="text-xs text-muted-foreground">This scene changed. Your trim fields are preserved.</p><Button type="button" size="sm" variant="ghost" onClick={()=>{setStart(clip.start);setEnd(clip.end);setBase({start:clip.start,end:clip.end});}}>Load latest trim</Button></>}</form><label className="space-y-1 text-xs">Split after (seconds)<Input type="number" min={0.01} step="any" value={split} onChange={e=>setSplit(Number(e.target.value))} /></label><Button variant="outline" size="sm" disabled={split<=0||split>=clip.end-clip.start} onClick={()=>onSplit(split)}><Scissors />Split scene</Button></Card>;
}
