"use client";
import { useEffect, useRef, useState } from "react";
import { Film, ImageIcon, Music, Play, Plus, Trash2, Layers, Maximize2, Check, X } from "lucide-react";
import { Popover } from "@base-ui/react/popover";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger, DialogFooter, DialogClose } from "./ui/dialog";

export type ViewerAsset = { key:string; id:string; name:string; kind:"video"|"image"|"audio"; url:string; duration?:number|null; width?:number|null; height?:number|null; license?:string|null; attribution?:string|null; used?:boolean; removable?:boolean };
const durationLabel=(seconds?:number|null)=>seconds==null?null:`${Math.floor(seconds/60)}:${Math.floor(seconds%60).toString().padStart(2,"0")}`;

function VideoThumbnail({url}:{url:string}) {
  const ref=useRef<HTMLVideoElement>(null),[visible,setVisible]=useState(false);
  useEffect(()=>{const el=ref.current;if(!el)return;const observer=new IntersectionObserver(([entry])=>{if(entry.isIntersecting){setVisible(true);observer.disconnect();}},{rootMargin:"100px"});observer.observe(el);return()=>observer.disconnect();},[]);
  return <video ref={ref} src={visible?url:undefined} muted playsInline preload="metadata" aria-hidden tabIndex={-1} className="absolute inset-0 size-full object-cover" onLoadedMetadata={e=>{const video=e.currentTarget;if(video.duration>0.1)video.currentTime=.1;}} />;
}
function Thumbnail({asset}:{asset:ViewerAsset}) {
  return <span className="relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-xl bg-black/40">
    {asset.kind==='video'?<><Film aria-hidden className="size-7 text-white/30" /><VideoThumbnail key={asset.url} url={asset.url}/></>:asset.kind==='image'?<img src={asset.url} alt="" loading="lazy" className="absolute inset-0 size-full object-cover" />:<span aria-hidden className="flex h-10 items-center gap-1 text-primary/55">{[12,24,17,36,26,40,18,30,12].map((height,i)=><span key={i} className="w-1 rounded-full bg-current" style={{height}} />)}</span>}
    <span className="pointer-events-none absolute inset-0 rounded-xl border border-white/10" />
    <span className="absolute right-1.5 bottom-1.5 rounded-md bg-black/75 px-1.5 py-0.5 text-[10px] text-white tabular-nums">{durationLabel(asset.duration)??(asset.kind==='image'?'Image':asset.kind==='audio'?'Audio':'Video')}</span>
    {asset.used&&<span className="absolute top-1.5 left-1.5 rounded-full bg-black/75 p-1 text-primary" title="Used in this edit"><Check aria-hidden className="size-3" /><span className="sr-only">Used in this edit</span></span>}
  </span>;
}
function Preview({asset,large=false}:{asset:ViewerAsset;large?:boolean}) {
  const [error,setError]=useState(false);
  const size=large?'min-h-64 max-h-[55dvh]':'aspect-video';
  return <div className={`relative flex w-full items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-black ${size}`}>
    {error?<p role="status" className="p-5 text-center text-xs text-muted-foreground">Preview unavailable. Try selecting the asset again.</p>:asset.kind==='video'?<video key={asset.key} src={asset.url} controls playsInline preload="metadata" aria-label={`Preview ${asset.name}`} onError={()=>setError(true)} className={`w-full object-contain ${large?'max-h-[55dvh]':'aspect-video'}`} />:asset.kind==='image'?<img src={asset.url} alt={asset.name} onError={()=>setError(true)} className={`w-full object-contain ${large?'max-h-[55dvh]':'aspect-video'}`} />:<div className="flex w-full flex-col items-center gap-5 p-4"><Music aria-hidden className="size-8 text-primary/70" /><audio key={asset.key} src={asset.url} controls preload="metadata" aria-label={`Preview ${asset.name}`} onError={()=>setError(true)} className="h-9 w-full min-w-0" /></div>}
  </div>;
}
export function AssetViewer({assets,selectedKey,onSelect,onPlace,onOverlay,onRemove,disabled,videoAction='Add to timeline',emptyMessage}:{assets:ViewerAsset[];selectedKey:string|null;onSelect:(key:string)=>void;onPlace:(asset:ViewerAsset,mode?:'music'|'sfx')=>void;onOverlay?:(asset:ViewerAsset)=>void;onRemove?:(asset:ViewerAsset)=>void;disabled:boolean;videoAction?:string;emptyMessage:string}) {
  const selected=assets.find(a=>a.key===selectedKey);
  const [expanded,setExpanded]=useState(false);
  const [previewKey,setPreviewKey]=useState<string|null>(null);
  const actions=(asset:ViewerAsset)=><div className="flex flex-wrap items-center gap-2"><Button size="sm" disabled={disabled} onClick={()=>onPlace(asset,asset.kind==='audio'?'music':undefined)}><Plus />{asset.kind==='video'?videoAction:asset.kind==='image'?'Add image':'Use as music'}</Button>{asset.kind==='video'&&onOverlay&&<Button size="sm" variant="outline" disabled={disabled} onClick={()=>onOverlay(asset)}><Layers />Overlay at playhead</Button>}{asset.kind==='audio'&&<Button size="sm" variant="outline" disabled={disabled} onClick={()=>onPlace(asset,'sfx')}>Add sound</Button>}{asset.removable&&onRemove&&<Button size="icon-sm" variant="ghost" aria-label={`Remove media ${asset.name}`} disabled={disabled} onClick={()=>onRemove(asset)}><Trash2 /></Button>}</div>;
  const metadata=(asset:ViewerAsset)=><div className="space-y-1"><p className="break-words text-sm font-medium">{asset.name}</p><p className="text-[11px] text-muted-foreground">{[asset.kind==='video'?'Video':asset.kind==='image'?'Image':'Audio',asset.width&&asset.height?`${asset.width} × ${asset.height}`:null,durationLabel(asset.duration)].filter(Boolean).join(' · ')}</p>{asset.attribution&&<p className="break-words text-[11px] text-muted-foreground">{asset.attribution}</p>}{asset.license&&<p className="text-[11px] text-muted-foreground">{asset.license}</p>}</div>;
  const grid=(large=false)=><div className={`grid gap-2 ${large?'grid-cols-1 min-[420px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4':'grid-cols-2'}`}>{assets.map(asset=>{const card=<button key={asset.key} type="button" draggable={!disabled} onDragStart={e=>{e.dataTransfer.effectAllowed="copy";e.dataTransfer.setData("application/x-agentcut-media",JSON.stringify(asset.kind==='video'?{mediaId:asset.id}:{assetId:asset.id}));}} aria-label={`Select asset ${asset.name}`} aria-pressed={asset.key===selectedKey} onClick={()=>onSelect(asset.key)} className={`group relative min-w-0 cursor-grab active:cursor-grabbing ${large?"overflow-hidden rounded-lg border p-0":"rounded-2xl border p-1.5"} text-left transition-[border-color,background-color] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${asset.key===selectedKey?'border-primary/65 bg-primary/8':'border-transparent hover:border-white/15 hover:bg-white/5'}`}><Thumbnail asset={asset}/><span className={large?"absolute inset-x-0 bottom-0 flex min-w-0 items-center gap-2 bg-gradient-to-t from-black/95 via-black/65 to-transparent px-3 pb-3 pt-9 text-white":"mt-2 flex min-w-0 items-center gap-1.5 px-0.5"}>{asset.kind==='video'?<Film aria-hidden className="size-3 shrink-0 text-muted-foreground" />:asset.kind==='image'?<ImageIcon aria-hidden className="size-3 shrink-0 text-muted-foreground" />:<Music aria-hidden className="size-3 shrink-0 text-muted-foreground" />}<span className={large?"truncate text-sm":"truncate text-[11px]"} title={asset.name}>{asset.name}</span></span></button>;
    return large ? <Popover.Root key={asset.key} open={previewKey===asset.key} onOpenChange={open=>setPreviewKey(open?asset.key:null)}>
      <Popover.Trigger render={card} />
      <Popover.Portal><Popover.Positioner side="top" sideOffset={10} collisionAvoidance={{side:"shift",align:"shift"}} collisionPadding={12} className="z-[60] max-w-[calc(100vw-1.5rem)]">
        <Popover.Popup className="dialog-surface w-[360px] max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-xl border border-white/20 p-3 outline-none">
          <div className="mb-2 flex items-center gap-2"><Popover.Title className="min-w-0 flex-1 truncate text-sm font-medium">{asset.name}</Popover.Title><Popover.Close render={<Button size="icon-xs" variant="ghost" aria-label="Close asset preview"/>}><X/></Popover.Close></div>
          <Preview asset={asset}/>
        </Popover.Popup>
      </Popover.Positioner></Popover.Portal>
    </Popover.Root> : card;
  })}</div>;
  return <div className="space-y-4">
    <div className="flex items-center justify-between gap-2"><span className="text-[11px] text-muted-foreground">{assets.length} {assets.length===1?'asset':'assets'}</span><Dialog open={expanded} onOpenChange={open=>{setExpanded(open);if(!open)setPreviewKey(null);}}><DialogTrigger render={<Button variant="ghost" size="xs" disabled={!assets.length} />}><Maximize2 />Expand assets</DialogTrigger><DialogContent className="flex h-[min(820px,calc(100dvh-2rem))] flex-col overflow-hidden sm:max-w-[min(1200px,calc(100vw-3rem))]">
      <DialogHeader><DialogTitle>Choose an asset</DialogTitle><DialogDescription>Browse your media, preview a selection, then add it to your video.</DialogDescription></DialogHeader>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-0.5 pb-4">
        {grid(true)}

      </div>
      <DialogFooter className="shrink-0 sm:items-center sm:justify-between">
        <div className="min-w-0 sm:mr-auto">{selected?metadata(selected):<p className="text-sm text-muted-foreground">Select an asset</p>}</div>
        <div className="flex flex-wrap items-center gap-2"><DialogClose render={<Button variant="outline" size="sm"/>}>Cancel</DialogClose>{selected&&actions(selected)}</div>
      </DialogFooter>
    </DialogContent></Dialog></div>
    {assets.length?<div className="max-h-[32dvh] overflow-y-auto p-0.5">{grid()}</div>:<div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-white/15 px-4 py-8 text-center"><Film aria-hidden className="size-6 text-muted-foreground" /><p className="text-xs leading-relaxed text-muted-foreground">{emptyMessage}</p></div>}
    {selected?<section aria-label="Selected asset" className="space-y-3 rounded-2xl border border-white/10 bg-black/25 p-3"><div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground"><Play aria-hidden className="size-3" />Source preview</div>{!expanded&&<Preview key={selected.key} asset={selected}/>} {metadata(selected)}{actions(selected)}</section>:!!assets.length&&<p className="text-center text-[11px] text-muted-foreground">Select to preview, or drag media onto the timeline.</p>}
  </div>;
}
