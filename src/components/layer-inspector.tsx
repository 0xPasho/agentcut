"use client";
import { useEffect, useId, useState } from "react";
import { Diamond, Eraser } from "lucide-react";
import { DEFAULT_ITEM_TRANSFORM, type SequenceItem, type VideoSequence } from "@/lib/edl";
import type { EditorOperation } from "@/lib/editor/operations";
import { sequenceFrames } from "@/lib/sequences";
import { FIELD_LABELS, animatedFields, itemSeconds, type AnimatedField } from "@/lib/keyframes";
import { PLAYHEAD_OUTSIDE_SHOT, clearField, setKeyframe } from "@/lib/editor/motion";
import { usePlayheadSelector, usePlayheadStore } from "@/lib/editor/playhead";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";

const placement = (item: SequenceItem) => ({ at:item.at ?? null, layer:item.layer ?? 0, transform:{...DEFAULT_ITEM_TRANSFORM,...item.transform}, volume:item.volume ?? 1, muted:item.muted ?? false, hidden:item.hidden ?? false });
const TRANSFORM_FIELDS = [['x','Left (%)'],['y','Top (%)'],['width','Width (%)'],['height','Height (%)'],['rotation','Rotation (degrees)'],['opacity','Opacity']] as const;

export function LayerInspector({sequence,item,dispatch}:{sequence:VideoSequence;item:SequenceItem;dispatch:(ops:EditorOperation[])=>void}) {
  const current = placement(item), signature=JSON.stringify(current);
  const [draft,setDraft]=useState(current),[base,setBase]=useState(signature);
  const stale=base!==signature;
  useEffect(()=>{if(stale && JSON.stringify(draft)===base){setDraft(JSON.parse(signature));setBase(signature);}},[stale,draft,base,signature]);
  const fps=sequence.output.fps;
  const resolved=sequenceFrames(sequence).items.find(i=>i.item.id===item.id)!.from/fps;
  const span=itemSeconds(item,fps);
  // A field the layer's motion decides is not settable to a fixed value — the operation
  // refuses it, because it could never be seen. Say so here rather than let the refusal
  // be the first anyone hears of it, and say what to do instead: the two things that are
  // true of an animated field are that this moment can hold the number, or that the field
  // can stop moving. Both are ordinary `item.keyframes` edits, the same ones an agent makes.
  const animated=animatedFields(item.keyframes),motionId=useId();
  const note=animated.size?`${[...animated].map(field=>FIELD_LABELS[field]).join(", ")} ${animated.size===1?"is":"are"} animated, so a fixed value here would never be seen. Pin the number you typed at the playhead, or stop animating the field.`:"";
  const playhead=usePlayheadStore();
  /** Where the playhead is inside this shot, on a frame, or `null` when it is elsewhere. */
  const localAt=(at:number)=>{const local=Math.round((at-resolved)*fps)/fps;return local>=0&&local<=span+1e-6?local:null;};
  const inside=usePlayheadSelector(at=>localAt(at)!==null);
  const motion=(keyframes:ReturnType<typeof clearField>)=>dispatch([{type:"item.keyframes",sequenceId:sequence.id,itemId:item.id,keyframes,before:item.keyframes??null}]);
  /** The typed number, pinned where the playhead is; the fixed field goes back to what it was. */
  const pin=(field:AnimatedField,value:number)=>{
    const at=localAt(playhead.get());
    if(at===null)return;
    motion(setKeyframe(item,at,{[field]:value}));
    setDraft(field==="volume"?{...draft,volume:current.volume}:{...draft,transform:{...draft.transform,[field]:current.transform[field as keyof typeof current.transform]}});
  };
  // Each pair names its own field: four fields animating means four of these, and four
  // buttons all called "Pin it here" is four buttons a screen reader cannot tell apart.
  const actions=(field:AnimatedField,value:number)=>animated.has(field)?<div className="flex flex-wrap items-center gap-1.5 pt-1">
    <Button type="button" size="xs" variant="outline" disabled={!inside} onClick={()=>pin(field,value)}><Diamond />Pin the {FIELD_LABELS[field]} here</Button>
    <Button type="button" size="xs" variant="ghost" onClick={()=>motion(clearField(item.keyframes,field))}><Eraser />Stop animating the {FIELD_LABELS[field]}</Button>
  </div>:null;
  // No card and no heading of its own: the section this opens out of is already called
  // Position & audio, and a panel inside a panel draws two edges around one thing.
  return <div className="flex min-w-0 flex-col gap-3"><p className="text-xs leading-relaxed text-muted-foreground">Higher layers appear above lower ones. Timing is independent of the footage beneath.</p>
    <form className="space-y-3" onSubmit={e=>{e.preventDefault();if(stale)return;dispatch([{type:"item.place",sequenceId:sequence.id,itemId:item.id,patch:draft,before:JSON.parse(base)}]);setBase(JSON.stringify(draft));}}>
      <div className="grid grid-cols-2 gap-3"><label className="space-y-1 text-xs">Timeline start (seconds)<Input required type="number" min={0} step="any" value={draft.at ?? resolved} onChange={e=>setDraft({...draft,at:Number(e.target.value)})} /></label><label className="space-y-1 text-xs">Layer<Input required type="number" min={0} step={1} value={draft.layer} onChange={e=>setDraft({...draft,layer:Number(e.target.value)})} /></label></div>
      <Checkbox className="text-xs" checked={draft.at===null} onCheckedChange={on=>setDraft({...draft,at:on?null:resolved})}>Follow previous item on this layer</Checkbox>
      {/* The way out sits under the field it is about, outside its label: a button inside a
          label forwards its click to the input, which is not what pinning a moment means. */}
      <div className="grid grid-cols-2 gap-3">{TRANSFORM_FIELDS.map(([key,label])=><div key={key} className={animated.has(key)?"col-span-2":undefined}>
        <label className="block space-y-1 text-xs">{label}{animated.has(key)&&<span className="ml-1 text-muted-foreground">· animated</span>}<Input required type="number" step="any" aria-describedby={animated.has(key)?motionId:undefined} min={key==='width'||key==='height'?0.01:key==='opacity'?0:undefined} max={key==='opacity'?1:undefined} value={draft.transform[key]} onChange={e=>setDraft({...draft,transform:{...draft.transform,[key]:Number(e.target.value)}})} /></label>
        {actions(key,draft.transform[key])}
      </div>)}</div>
      <div><label className="block space-y-1 text-xs">Volume{animated.has("volume")&&<span className="ml-1 text-muted-foreground">· animated</span>}<Input required type="number" min={0} max={2} step="any" aria-describedby={animated.has("volume")?motionId:undefined} value={draft.volume} onChange={e=>setDraft({...draft,volume:Number(e.target.value)})} /></label>{actions("volume",draft.volume)}</div>
      {note&&<p id={motionId} className="text-[11px] leading-relaxed text-muted-foreground">{note}{!inside&&` ${PLAYHEAD_OUTSIDE_SHOT}`}</p>}
      <div className="flex flex-wrap gap-4"><Checkbox className="text-xs" checked={draft.muted} onCheckedChange={muted=>setDraft({...draft,muted})}>Mute audio</Checkbox><Checkbox className="text-xs" checked={draft.hidden} onCheckedChange={hidden=>setDraft({...draft,hidden})}>Hide visuals</Checkbox></div>
      {stale&&<p role="status" className="text-xs text-muted-foreground">The layer changed while these fields were open. Your unsaved fields are kept — load the latest placement to continue.</p>}
      <div className="flex flex-wrap gap-2"><Button type="submit" variant="outline" size="sm" disabled={stale}>Apply placement</Button>{stale&&<Button type="button" variant="ghost" size="sm" onClick={()=>{setDraft(current);setBase(signature);}}>Load latest placement</Button>}</div>
    </form>
    <div className="flex flex-wrap gap-2"><Button size="xs" variant="outline" disabled={sequence.items[0]?.id===item.id} onClick={()=>dispatch([{type:"item.move",sequenceId:sequence.id,itemId:item.id,index:sequence.items.findIndex(i=>i.id===item.id)-1}])}>Earlier in order</Button><Button size="xs" variant="outline" disabled={sequence.items.at(-1)?.id===item.id} onClick={()=>dispatch([{type:"item.move",sequenceId:sequence.id,itemId:item.id,index:sequence.items.findIndex(i=>i.id===item.id)+1}])}>Later in order</Button></div>
    <Button size="sm" variant="ghost" onClick={()=>dispatch([{type:"item.remove",sequenceId:sequence.id,itemId:item.id}])}>Remove selected item</Button>
  </div>;
}
