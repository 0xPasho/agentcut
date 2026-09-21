"use client";
import { useEffect, useId, useState } from "react";
import { DEFAULT_ITEM_TRANSFORM, type SequenceItem, type VideoSequence } from "@/lib/edl";
import type { EditorOperation } from "@/lib/editor/operations";
import { sequenceFrames } from "@/lib/sequences";
import { FIELD_LABELS, animatedFields } from "@/lib/keyframes";
import { Card } from "./ui/card";
import { Input } from "./ui/input";
import { Button } from "./ui/button";

const placement = (item: SequenceItem) => ({ at:item.at ?? null, layer:item.layer ?? 0, transform:{...DEFAULT_ITEM_TRANSFORM,...item.transform}, volume:item.volume ?? 1, muted:item.muted ?? false, hidden:item.hidden ?? false });
export function LayerInspector({sequence,item,dispatch}:{sequence:VideoSequence;item:SequenceItem;dispatch:(ops:EditorOperation[])=>void}) {
  const current = placement(item), signature=JSON.stringify(current);
  const [draft,setDraft]=useState(current),[base,setBase]=useState(signature);
  const stale=base!==signature;
  useEffect(()=>{if(stale && JSON.stringify(draft)===base){setDraft(JSON.parse(signature));setBase(signature);}},[stale,draft,base,signature]);
  const resolved=sequenceFrames(sequence).items.find(i=>i.item.id===item.id)!.from/sequence.output.fps;
  // A field the layer's motion decides is not settable to a fixed value — the operation
  // refuses it, because it could never be seen. Say so here rather than let the refusal
  // be the first anyone hears of it. The number stays: clearing the motion reveals it again.
  const animated=animatedFields(item.keyframes),motionId=useId();
  const note=animated.size?`${[...animated].map(field=>FIELD_LABELS[field]).join(", ")} ${animated.size===1?"is":"are"} animated, so a fixed value here would never be seen. Change ${animated.size===1?"it":"them"} under Motion.`:"";
  return <Card className="shrink-0 gap-3 p-4"><h2 className="text-sm font-medium">Layer placement</h2><p className="text-xs text-muted-foreground">Higher layers appear above lower ones. Timing is independent of the footage beneath.</p>
    <form className="space-y-3" onSubmit={e=>{e.preventDefault();if(stale)return;dispatch([{type:"item.place",sequenceId:sequence.id,itemId:item.id,patch:draft,before:JSON.parse(base)}]);setBase(JSON.stringify(draft));}}>
      <div className="grid grid-cols-2 gap-3"><label className="space-y-1 text-xs">Timeline start (seconds)<Input required type="number" min={0} step="any" value={draft.at ?? resolved} onChange={e=>setDraft({...draft,at:Number(e.target.value)})} /></label><label className="space-y-1 text-xs">Layer<Input required type="number" min={0} step={1} value={draft.layer} onChange={e=>setDraft({...draft,layer:Number(e.target.value)})} /></label></div>
      <label className="flex min-h-9 items-center gap-2 text-xs"><input type="checkbox" checked={draft.at===null} onChange={e=>setDraft({...draft,at:e.target.checked?null:resolved})} />Follow previous item on this layer</label>
      <div className="grid grid-cols-2 gap-3">{([['x','Left (%)'],['y','Top (%)'],['width','Width (%)'],['height','Height (%)'],['rotation','Rotation (degrees)'],['opacity','Opacity']] as const).map(([key,label])=><label key={key} className="space-y-1 text-xs">{label}{animated.has(key)&&<span className="ml-1 text-muted-foreground">· animated</span>}<Input required type="number" step="any" aria-describedby={animated.has(key)?motionId:undefined} min={key==='width'||key==='height'?0.01:key==='opacity'?0:undefined} max={key==='opacity'?1:undefined} value={draft.transform[key]} onChange={e=>setDraft({...draft,transform:{...draft.transform,[key]:Number(e.target.value)}})} /></label>)}</div>
      <label className="block space-y-1 text-xs">Volume{animated.has("volume")&&<span className="ml-1 text-muted-foreground">· animated</span>}<Input required type="number" min={0} max={2} step="any" aria-describedby={animated.has("volume")?motionId:undefined} value={draft.volume} onChange={e=>setDraft({...draft,volume:Number(e.target.value)})} /></label>
      {note&&<p id={motionId} className="text-[11px] leading-relaxed text-muted-foreground">{note}</p>}
      <div className="flex flex-wrap gap-4"><label className="flex min-h-9 items-center gap-2 text-xs"><input type="checkbox" checked={draft.muted} onChange={e=>setDraft({...draft,muted:e.target.checked})} />Mute audio</label><label className="flex min-h-9 items-center gap-2 text-xs"><input type="checkbox" checked={draft.hidden} onChange={e=>setDraft({...draft,hidden:e.target.checked})} />Hide visuals</label></div>
      {stale&&<p role="status" className="text-xs text-muted-foreground">This layer changed. Your fields are preserved; load the latest placement to continue.</p>}
      <div className="flex flex-wrap gap-2"><Button type="submit" variant="outline" size="sm" disabled={stale}>Apply placement</Button>{stale&&<Button type="button" variant="ghost" size="sm" onClick={()=>{setDraft(current);setBase(signature);}}>Load latest placement</Button>}</div>
    </form>
    <div className="flex flex-wrap gap-2"><Button size="xs" variant="outline" disabled={sequence.items[0]?.id===item.id} onClick={()=>dispatch([{type:"item.move",sequenceId:sequence.id,itemId:item.id,index:sequence.items.findIndex(i=>i.id===item.id)-1}])}>Earlier in order</Button><Button size="xs" variant="outline" disabled={sequence.items.at(-1)?.id===item.id} onClick={()=>dispatch([{type:"item.move",sequenceId:sequence.id,itemId:item.id,index:sequence.items.findIndex(i=>i.id===item.id)+1}])}>Later in order</Button></div>
    <Button size="sm" variant="ghost" onClick={()=>dispatch([{type:"item.remove",sequenceId:sequence.id,itemId:item.id}])}>Remove selected item</Button>
  </Card>;
}
