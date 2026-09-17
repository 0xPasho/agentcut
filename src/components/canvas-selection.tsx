"use client";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { DEFAULT_ITEM_TRANSFORM, type SequenceItem, type VideoSequence } from "@/lib/edl";
import { sequenceFrames } from "@/lib/sequences";
import type { EditorOperation } from "@/lib/editor/operations";

type Transform = typeof DEFAULT_ITEM_TRANSFORM;
export type CanvasPreview = { id: string; transform: Transform } | null;
/** The draft is preview-only; release commits one shared item.place transaction. */
export function CanvasSelection({item,sequence,currentSec,dispatch,onPreview}:{item:SequenceItem;sequence:VideoSequence;currentSec:number;dispatch:(ops:EditorOperation[])=>void;onPreview:(preview:CanvasPreview)=>void}) {
  const area=useRef<HTMLDivElement>(null);
  const [bounds,setBounds]=useState<{left:number;top:number;width:number;height:number}|null>(null);
  const drag=useRef<{x:number;y:number;transform:Transform;resize:boolean;rect:DOMRect;bounds:typeof bounds}|null>(null);
  const transform={...DEFAULT_ITEM_TRANSFORM,...item.transform};
  const entry=sequenceFrames(sequence).items.find(i=>i.item.id===item.id)!;
  const active=currentSec>=entry.from/sequence.output.fps && currentSec<(entry.from+entry.duration)/sequence.output.fps && !item.hidden;
  const titleOnly=item.mediaId===null && item.clip.edits.length===1 && item.clip.edits[0].type==="text";
  useEffect(()=>{
    if(!active)return;
    let frame=0;
    const measure=()=>{
      const container=area.current;
      const layer=container?.parentElement?.querySelector(`[data-canvas-item="${CSS.escape(item.id)}"]`);
      const target=titleOnly ? layer?.querySelector("[data-canvas-title]") : layer;
      if(container && target){
        const outer=container.getBoundingClientRect(),rect=target.getBoundingClientRect();
        const next={left:rect.left-outer.left,top:rect.top-outer.top,width:rect.width,height:rect.height};
        setBounds(old=>old&&Object.keys(next).every(key=>Math.abs(old[key as keyof typeof old]-next[key as keyof typeof next])<.1)?old:next);
      }
      frame=requestAnimationFrame(measure);
    };
    frame=requestAnimationFrame(measure);
    return()=>cancelAnimationFrame(frame);
  },[active,item.id,titleOnly]);
  useEffect(()=>{
    const cancel=()=>{drag.current=null;onPreview(null);};
    const key=(event:KeyboardEvent)=>{if(event.key==="Escape")cancel();};
    window.addEventListener("keydown",key);window.addEventListener("blur",cancel);
    return()=>{window.removeEventListener("keydown",key);window.removeEventListener("blur",cancel);onPreview(null);};
  },[onPreview]);
  const commit=(next:Transform,before=transform)=>dispatch([{type:"item.place",sequenceId:sequence.id,itemId:item.id,patch:{transform:Object.fromEntries(Object.entries(next).map(([key,value])=>[key,Math.round(value*1000)/1000]))},before:{transform:before}}]);
  const begin=(event:PointerEvent<HTMLButtonElement>,resize:boolean)=>{
    if(event.button!==0||!area.current)return;
    event.preventDefault();event.stopPropagation();event.currentTarget.focus({preventScroll:true});
    drag.current={x:event.clientX,y:event.clientY,transform,resize,rect:area.current.getBoundingClientRect(),bounds};
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const nextAt=(event:PointerEvent<HTMLButtonElement>)=>{
    const d=drag.current;if(!d)return null;
    const dx=event.clientX-d.x,dy=event.clientY-d.y;
    if(!d.resize)return {...d.transform,x:d.transform.x+dx/d.rect.width*100,y:d.transform.y+dy/d.rect.height*100};
    if(titleOnly && d.bounds && d.transform.rotation===0){
      const sx=Math.max(.01,(d.bounds.width+dx)/d.bounds.width),sy=Math.max(.01,(d.bounds.height+dy)/d.bounds.height);
      return {...d.transform,width:d.transform.width*sx,height:d.transform.height*sy,
        x:d.transform.x-(d.bounds.left/d.rect.width*100-d.transform.x)*(sx-1),
        y:d.transform.y-(d.bounds.top/d.rect.height*100-d.transform.y)*(sy-1)};
    }
    const r=d.transform.rotation*Math.PI/180;
    return {...d.transform,width:Math.max(.1,d.transform.width+(dx*Math.cos(r)+dy*Math.sin(r))/d.rect.width*100),height:Math.max(.1,d.transform.height+(-dx*Math.sin(r)+dy*Math.cos(r))/d.rect.height*100)};
  };
  const events={
    onClick:(event:React.MouseEvent<HTMLButtonElement>)=>{event.preventDefault();event.stopPropagation();},
    onPointerMove:(event:PointerEvent<HTMLButtonElement>)=>{const next=nextAt(event);if(next)onPreview({id:item.id,transform:next});},
    onPointerUp:(event:PointerEvent<HTMLButtonElement>)=>{event.preventDefault();event.stopPropagation();const next=nextAt(event),d=drag.current;if(next&&d)commit(next,d.transform);drag.current=null;onPreview(null);},
    onPointerCancel:()=>{drag.current=null;onPreview(null);},
  };
  if(!active)return null;
  return <div ref={area} className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl">
    {bounds && <div style={{position:"absolute",...bounds}} className="border border-primary">
      <button type="button" aria-label={`Move ${item.clip.title} on canvas`} title="Drag to move. Arrow keys move 1%; Shift moves 5%." style={{bottom:Math.max(0,bounds.top+bounds.height-(area.current?.clientHeight??Infinity)+44)}} className="pointer-events-auto absolute inset-0 touch-none cursor-move bg-transparent focus-visible:outline-2 focus-visible:outline-ring"
        onKeyDown={e=>{const d=({ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]} as Record<string,number[]>)[e.key];if(!d)return;e.preventDefault();const step=e.shiftKey?5:1;commit({...transform,x:transform.x+d[0]*step,y:transform.y+d[1]*step});}}
        onPointerDown={e=>begin(e,false)} {...events} />
      <button type="button" aria-label={`Resize ${item.clip.title} on canvas`} title="Drag to resize. Arrow keys adjust width and height." style={{left:Math.max(0,Math.min(bounds.width-8,(area.current?.clientWidth??0)-bounds.left-16)),top:Math.max(0,Math.min(bounds.height-8,(area.current?.clientHeight??0)-bounds.top-60))}} className="pointer-events-auto absolute size-4 touch-none cursor-nwse-resize rounded-full border-2 border-background bg-primary focus-visible:outline-2 focus-visible:outline-ring"
        onKeyDown={e=>{const d=({ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]} as Record<string,number[]>)[e.key];if(!d)return;e.preventDefault();commit({...transform,width:Math.max(.1,transform.width+d[0]),height:Math.max(.1,transform.height+d[1])});}}
        onPointerDown={e=>begin(e,true)} {...events} />
    </div>}
  </div>;
}
