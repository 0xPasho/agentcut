"use client";

import { useState } from "react";
import { Captions, X } from "lucide-react";
import { Button } from "../../../common/ui/button";
import { Card } from "../../../common/ui/card";
import { Textarea } from "../../../common/ui/textarea";
import { CaptionControls } from "./caption-controls";
import { captionCues, replaceCaptionText } from "../lib/caption-track";
import { fmt } from "../../transcription/lib/transcript";
import type { CaptionCue, CaptionStyle, Clip } from "../types";

export function CaptionEditor({ clip, selectedWord, onSelect, onChange, onApplyStyle, onClose }: {
  clip: Clip; selectedWord: number; onSelect: (word: number, time: number) => void;
  onChange: (clip: Clip) => void; onApplyStyle: (style: CaptionStyle) => void; onClose: () => void;
}) {
  const cues = captionCues(clip);
  const cue = cues.find(cue => cue.indices.includes(selectedWord)) ?? cues[0];
  return <Card className="shrink-0 gap-4 p-4" aria-label="Caption editor">
    <div className="flex items-center justify-between"><h2 className="flex items-center gap-2 text-sm font-medium"><Captions className="size-4" aria-hidden />Captions</h2><Button size="icon-sm" variant="ghost" aria-label="Close captions" onClick={onClose}><X aria-hidden /></Button></div>
    <p className="text-xs text-muted-foreground">{clip.title}</p>
    {cue ? <CaptionText key={`${clip.id}:${cue.indices[0]}:${cue.text}`} cue={cue} onSave={text => onChange({ ...clip, words: replaceCaptionText(clip, cue.indices, text) })} /> : <p className="text-xs text-muted-foreground">This clip has no caption words yet. Import or transcribe its audio to get started.</p>}
    <div className="flex max-h-40 flex-col gap-1 overflow-y-auto" aria-label="Caption phrases">
      {cues.map((entry, index) => <Button key={entry.indices[0]} variant={entry === cue ? "secondary" : "ghost"} className="h-auto justify-start whitespace-normal py-2 text-left" aria-pressed={entry === cue} onClick={() => onSelect(entry.indices[0], entry.start)}><span className="text-xs text-muted-foreground tabular-nums">{index + 1}</span>{entry.text}</Button>)}
    </div>
    <CaptionControls value={clip.captions} onChange={captions => onChange({ ...clip, captions })} />
    <p className="text-xs text-muted-foreground">Style changes apply to this clip.</p>
    <Button variant="outline" onClick={() => onApplyStyle(clip.captions)}>Apply style to all captions</Button>
  </Card>;
}

function CaptionText({ cue, onSave }: { cue: CaptionCue; onSave: (text: string) => void }) {
  const [text, setText] = useState(cue.text);
  return <form className="flex flex-col gap-2" onSubmit={event => { event.preventDefault(); onSave(text); }}>
    <label className="flex flex-col gap-2 text-xs text-muted-foreground">Caption text · {fmt(cue.start)}–{fmt(cue.end)}
      <Textarea value={text} onChange={event => setText(event.target.value)} rows={3} className="text-sm text-foreground" />
    </label>
    <p className="text-xs text-muted-foreground">Changing the word count redistributes timing within this phrase.</p>
    <Button type="submit" size="sm" disabled={text === cue.text}>Save text</Button>
  </form>;
}
