"use client";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { DEFAULT_ITEM_TRANSFORM, type Clip, type SequenceItem, type VideoSequence } from "@/lib/edl";
import { sequenceFrames } from "@/lib/sequences";
import type { EditorOperation } from "@/lib/editor/operations";
import { snapAxis } from "@/lib/editor/snapping";
import { moveOverlay, overlayLabel, type Box, type OverlayTarget } from "@/lib/editor/canvas";
import { usePlayhead } from "@/lib/editor/playhead";

type Transform = typeof DEFAULT_ITEM_TRANSFORM;
const SNAP_PX = 8;
/** The player's own controls live along the bottom edge; handles stay clear of them. */
const CONTROLS_PX = 44;
export type CanvasPreview = { id: string; transform?: Transform; clip?: Clip } | null;
type Inner = { key: string; target: OverlayTarget; box: Box };
const ARROWS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
const sameBox = (a: Box, b: Box) => (Object.keys(a) as (keyof Box)[]).every(key => Math.abs(a[key] - b[key]) < .1);

/**
 * A grid over the frame while something is being dragged: thirds and the centre read as the
 * lines to land on, the finer 10% mesh keeps the size of what is moving legible against it.
 */
export function CanvasGrid() {
  return <div aria-hidden className="pointer-events-none absolute inset-0 z-10 overflow-hidden rounded-2xl">
    <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,.09)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,.09)_1px,transparent_1px)] bg-[size:10%_10%]" />
    {[1 / 3, 2 / 3].map(f => <span key={`x${f}`} className="absolute inset-y-0 w-px bg-white/35" style={{ left: `${f * 100}%` }} />)}
    {[1 / 3, 2 / 3].map(f => <span key={`y${f}`} className="absolute inset-x-0 h-px bg-white/35" style={{ top: `${f * 100}%` }} />)}
    <span className="absolute inset-y-0 left-1/2 w-px bg-primary/50" /><span className="absolute inset-x-0 top-1/2 h-px bg-primary/50" />
  </div>;
}

/** The draft is preview-only; release commits one shared item.place or item.patch transaction. */
export function CanvasSelection({item,sequence,dispatch,onPreview,selectedEdit=null,onSelectEdit,onSelectCaptions}:{item:SequenceItem;sequence:VideoSequence;dispatch:(ops:EditorOperation[])=>void;onPreview:(preview:CanvasPreview)=>void;selectedEdit?:number|null;onSelectEdit?:(index:number)=>void;onSelectCaptions?:()=>void}) {
  // Handles only show while the preview is paused, so following every frame costs nothing.
  const currentSec=usePlayhead();
  const area=useRef<HTMLDivElement>(null);
  const [bounds,setBounds]=useState<Box|null>(null);
  const [frame,setFrame]=useState<Box|null>(null);
  const [inner,setInner]=useState<Inner[]>([]);
  const [guides,setGuides]=useState<{x:number|null;y:number|null}>({x:null,y:null});
  const [dragging,setDragging]=useState(false);
  const drag=useRef<{x:number;y:number;transform:Transform;resize:boolean;rect:DOMRect;bounds:typeof bounds}|null>(null);
  const innerDrag=useRef<{x:number;y:number;target:OverlayTarget;box:Box;frame:Box;clip:Clip;moved:boolean}|null>(null);
  const transform={...DEFAULT_ITEM_TRANSFORM,...item.transform};
  const entry=sequenceFrames(sequence).items.find(i=>i.item.id===item.id)!;
  const active=currentSec>=entry.from/sequence.output.fps && currentSec<(entry.from+entry.duration)/sequence.output.fps && !item.hidden;
  const titleOnly=item.mediaId===null && item.clip.edits.length===1 && item.clip.edits[0].type==="text";
  useEffect(()=>{
    if(!active)return;
    let raf=0;
    const measure=()=>{
      const container=area.current;
      const layer=container?.parentElement?.querySelector(`[data-canvas-item="${CSS.escape(item.id)}"]`);
      const target=titleOnly ? layer?.querySelector("[data-canvas-title]") : layer;
      if(container && layer && target){
        const outer=container.getBoundingClientRect(),rect=target.getBoundingClientRect();
        const relative=(r:DOMRect):Box=>({left:r.left-outer.left,top:r.top-outer.top,width:r.width,height:r.height});
        const next=relative(rect);
        setBounds(old=>old&&sameBox(old,next)?old:next);
        const layerBox=relative(layer.getBoundingClientRect());
        setFrame(old=>old&&sameBox(old,layerBox)?old:layerBox);
        // A standalone title is the layer; its handles already follow the text. Everything else
        // gets a handle per visible title, picture and caption block inside the layer.
        const found:Inner[]=titleOnly||transform.rotation!==0?[]:Array.from(layer.querySelectorAll<HTMLElement>("[data-canvas-edit],[data-canvas-captions]")).flatMap(el=>{
          const box=relative(el.getBoundingClientRect());
          if(!(box.width>0&&box.height>0))return[];
          const index=el.dataset.canvasEdit;
          const target:OverlayTarget=index!==undefined?{kind:"edit",index:Number(index)}:{kind:"captions"};
          return[{key:index??"captions",target,box}];
        });
        setInner(old=>old.length===found.length&&old.every((a,i)=>a.key===found[i].key&&sameBox(a.box,found[i].box))?old:found);
      }
      raf=requestAnimationFrame(measure);
    };
    // Measure once now so the handles are there on selection, then keep following the frame.
    measure();
    return()=>cancelAnimationFrame(raf);
  },[active,item.id,titleOnly,transform.rotation]);
  const settle=()=>{drag.current=null;innerDrag.current=null;setGuides({x:null,y:null});setDragging(false);onPreview(null);};
  useEffect(()=>{
    const key=(event:KeyboardEvent)=>{if(event.key==="Escape")settle();};
    window.addEventListener("keydown",key);window.addEventListener("blur",settle);
    return()=>{window.removeEventListener("keydown",key);window.removeEventListener("blur",settle);onPreview(null);};
  },[onPreview]);
  const commit=(next:Transform,before=transform)=>dispatch([{type:"item.place",sequenceId:sequence.id,itemId:item.id,patch:{transform:Object.fromEntries(Object.entries(next).map(([key,value])=>[key,Math.round(value*1000)/1000]))},before:{transform:before}}]);
  const commitClip=(next:Clip,before:Clip)=>{
    if(next.edits!==before.edits)dispatch([{type:"item.patch",sequenceId:sequence.id,itemId:item.id,patch:{edits:next.edits},before:{edits:before.edits}}]);
    else dispatch([{type:"item.patch",sequenceId:sequence.id,itemId:item.id,patch:{captions:{positionY:next.captions.positionY}},before:{captions:before.captions}}]);
  };
  const begin=(event:PointerEvent<HTMLButtonElement>,resize:boolean)=>{
    if(event.button!==0||!area.current)return;
    event.preventDefault();event.stopPropagation();event.currentTarget.focus({preventScroll:true});
    drag.current={x:event.clientX,y:event.clientY,transform,resize,rect:area.current.getBoundingClientRect(),bounds};
    setDragging(true);
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* the pointer ended before this handler ran; the drag still finishes on release */ }
  };
  const nextAt=(event:PointerEvent<HTMLButtonElement>)=>{
    const d=drag.current;if(!d)return null;
    let dx=event.clientX-d.x,dy=event.clientY-d.y;
    if(!d.resize){
      // Holding Command or Control passes the frame's edges and centre by, as it does on the timeline.
      const line:{x:number|null;y:number|null}={x:null,y:null};
      if(d.bounds && d.transform.rotation===0 && !(event.metaKey||event.ctrlKey)){
        const across=snapAxis(d.bounds.left+dx,d.bounds.width,d.rect.width,SNAP_PX);
        if(across){dx+=across.delta;line.x=across.guide;}
        const down=snapAxis(d.bounds.top+dy,d.bounds.height,d.rect.height,SNAP_PX);
        if(down){dy+=down.delta;line.y=down.guide;}
      }
      if(line.x!==guides.x||line.y!==guides.y)setGuides(line);
      return {...d.transform,x:d.transform.x+dx/d.rect.width*100,y:d.transform.y+dy/d.rect.height*100};
    }
    // Shift keeps the proportions the author already chose, on either resize path.
    if(titleOnly && d.bounds && d.transform.rotation===0){
      const sx=Math.max(.01,(d.bounds.width+dx)/d.bounds.width),sy=event.shiftKey?sx:Math.max(.01,(d.bounds.height+dy)/d.bounds.height);
      return {...d.transform,width:d.transform.width*sx,height:d.transform.height*sy,
        x:d.transform.x-(d.bounds.left/d.rect.width*100-d.transform.x)*(sx-1),
        y:d.transform.y-(d.bounds.top/d.rect.height*100-d.transform.y)*(sy-1)};
    }
    const r=d.transform.rotation*Math.PI/180;
    const width=Math.max(.1,d.transform.width+(dx*Math.cos(r)+dy*Math.sin(r))/d.rect.width*100);
    if(event.shiftKey && d.transform.width>0) return {...d.transform,width,height:Math.max(.1,width*d.transform.height/d.transform.width)};
    return {...d.transform,width,height:Math.max(.1,d.transform.height+(-dx*Math.sin(r)+dy*Math.cos(r))/d.rect.height*100)};
  };
  const events={
    onClick:(event:React.MouseEvent<HTMLButtonElement>)=>{event.preventDefault();event.stopPropagation();},
    onPointerMove:(event:PointerEvent<HTMLButtonElement>)=>{const next=nextAt(event);if(next)onPreview({id:item.id,transform:next});},
    onPointerUp:(event:PointerEvent<HTMLButtonElement>)=>{event.preventDefault();event.stopPropagation();const next=nextAt(event),d=drag.current;if(next&&d)commit(next,d.transform);settle();},
    onPointerCancel:settle,
  };
  /** The overlay's box in its own frame's pixels, which is what the shared placement maths wants. */
  const innerAt=(event:PointerEvent<HTMLButtonElement>)=>{
    const d=innerDrag.current;if(!d)return null;
    const dx=event.clientX-d.x,dy=event.clientY-d.y;
    if(Math.abs(dx)+Math.abs(dy)>2)d.moved=true;
    const snap=event.metaKey||event.ctrlKey?0:SNAP_PX;
    const box={left:d.box.left-d.frame.left,top:d.box.top-d.frame.top,width:d.box.width,height:d.box.height};
    const result=moveOverlay(d.clip,d.target,box,d.frame,dx,dy,snap);
    const line={x:result.guide.x===null?null:d.frame.left+result.guide.x,y:result.guide.y===null?null:d.frame.top+result.guide.y};
    if(line.x!==guides.x||line.y!==guides.y)setGuides(line);
    return result.clip;
  };
  const innerEvents=(handle:Inner)=>({
    onClick:(event:React.MouseEvent<HTMLButtonElement>)=>{event.preventDefault();event.stopPropagation();},
    onPointerDown:(event:PointerEvent<HTMLButtonElement>)=>{
      if(event.button!==0||!frame)return;
      event.preventDefault();event.stopPropagation();event.currentTarget.focus({preventScroll:true});
      innerDrag.current={x:event.clientX,y:event.clientY,target:handle.target,box:handle.box,frame,clip:item.clip,moved:false};
      setDragging(true);
      try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* the pointer ended before this handler ran; the drag still finishes on release */ }
    },
    onPointerMove:(event:PointerEvent<HTMLButtonElement>)=>{const next=innerAt(event);if(next&&innerDrag.current?.moved)onPreview({id:item.id,clip:next});},
    onPointerUp:(event:PointerEvent<HTMLButtonElement>)=>{
      event.preventDefault();event.stopPropagation();
      const d=innerDrag.current,next=innerAt(event);
      if(d&&next&&d.moved)commitClip(next,d.clip);
      // A press that never moved is a pick: it opens that overlay's controls.
      else if(d&&!d.moved){if(d.target.kind==="edit")onSelectEdit?.(d.target.index);else onSelectCaptions?.();}
      settle();
    },
    onPointerCancel:settle,
    onKeyDown:(event:React.KeyboardEvent<HTMLButtonElement>)=>{
      const arrow=ARROWS[event.key];if(!arrow||!frame)return;
      event.preventDefault();
      const step=(event.shiftKey?5:1)/100;
      const box={left:handle.box.left-frame.left,top:handle.box.top-frame.top,width:handle.box.width,height:handle.box.height};
      commitClip(moveOverlay(item.clip,handle.target,box,frame,arrow[0]*step*frame.width,arrow[1]*step*frame.height).clip,item.clip);
    },
  });
  if(!active)return null;
  const floor=(area.current?.clientHeight??Infinity)-CONTROLS_PX;
  return <div ref={area} className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl">
    {dragging && <CanvasGrid />}
    {guides.x!==null && <span aria-hidden className="pointer-events-none absolute inset-y-0 z-10 w-px bg-primary/90 shadow-[0_0_6px_rgba(255,218,42,.6)]" style={{left:guides.x}} />}
    {guides.y!==null && <span aria-hidden className="pointer-events-none absolute inset-x-0 z-10 h-px bg-primary/90 shadow-[0_0_6px_rgba(255,218,42,.6)]" style={{top:guides.y}} />}
    {bounds && <div style={{position:"absolute",...bounds}} className="z-10 border border-primary">
      <button type="button" aria-label={`Move ${item.clip.title} on canvas`} title="Drag to move; it snaps to the frame's edges and centre. Hold Command or Control to pass them by. Arrow keys move 1%; Shift moves 5%." style={{bottom:Math.max(0,bounds.top+bounds.height-floor)}} className="pointer-events-auto absolute inset-0 touch-none cursor-move bg-transparent focus-visible:outline-2 focus-visible:outline-ring"
        onKeyDown={e=>{const d=ARROWS[e.key];if(!d)return;e.preventDefault();const step=e.shiftKey?5:1;commit({...transform,x:transform.x+d[0]*step,y:transform.y+d[1]*step});}}
        onPointerDown={e=>begin(e,false)} {...events} />
      <button type="button" aria-label={`Resize ${item.clip.title} on canvas`} title="Drag to resize; hold Shift to keep its proportions. Arrow keys adjust width and height." style={{left:Math.max(0,Math.min(bounds.width-8,(area.current?.clientWidth??0)-bounds.left-16)),top:Math.max(0,Math.min(bounds.height-8,(area.current?.clientHeight??0)-bounds.top-60))}} className="pointer-events-auto absolute size-4 touch-none cursor-nwse-resize rounded-full border-2 border-background bg-primary focus-visible:outline-2 focus-visible:outline-ring"
        onKeyDown={e=>{const d=ARROWS[e.key];if(!d)return;e.preventDefault();commit({...transform,width:Math.max(.1,transform.width+d[0]),height:Math.max(.1,transform.height+d[1])});}}
        onPointerDown={e=>begin(e,true)} {...events} />
    </div>}
    {/* Titles, pictures and captions inside the layer sit above its own handle so they win the press. */}
    {inner.map(handle=>{
      const label=overlayLabel(item.clip,handle.target);
      const picked=handle.target.kind==="edit"&&handle.target.index===selectedEdit;
      const height=Math.max(8,Math.min(handle.box.height,floor-handle.box.top));
      return <button key={handle.key} type="button" aria-label={`Move ${label} on canvas`} aria-pressed={picked}
        title={handle.target.kind==="captions"?"Drag to move the captions up or down. Arrow keys move 1%; Shift moves 5%.":"Drag to move; it snaps to the frame's edges and centre. Hold Command or Control to pass them by. Click to edit it. Arrow keys move 1%; Shift moves 5%."}
        style={{position:"absolute",left:handle.box.left,top:handle.box.top,width:handle.box.width,height}}
        className={`pointer-events-auto z-20 touch-none rounded-md bg-transparent outline-1 outline-dashed focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-ring ${picked?"outline-primary":"outline-white/45 hover:outline-primary/80"} ${handle.target.kind==="captions"?"cursor-ns-resize":"cursor-move"}`}
        {...innerEvents(handle)} />;
    })}
  </div>;
}
