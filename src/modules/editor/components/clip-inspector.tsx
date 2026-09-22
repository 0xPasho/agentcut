"use client";

import { Trash2 } from "lucide-react";
import { Button } from "@/common/ui/button";
import { ColorField } from "@/common/ui/color-field";
import { Input } from "@/common/ui/input";
import { Label } from "@/common/ui/label";
import { Slider } from "@/common/ui/slider";
import { Checkbox } from "@/common/ui/checkbox";
import { Textarea } from "@/common/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/common/ui/select";
import { assetUrl } from "@/common/api/client";
import type { Edit } from "@/modules/editor/types";
import { describeAuthor } from "@/modules/editor/lib/authorship";
import { num } from "../lib/clip-inspector";
import { PRESET_Y } from "../data";

/** Edits the one selected edit. Fields differ per type, so this is a small switch. */
export function ClipInspector({
  projectId,
  edit,
  onChange,
  onRemove,
}: {
  projectId: string;
  edit: Edit;
  onChange: (next: Edit) => void;
  onRemove: () => void;
}) {
  const patch = (p: Partial<Edit>) => onChange({ ...edit, ...p } as Edit);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium capitalize">{edit.type}</span>
        <Button size="icon-sm" variant="ghost" aria-label="Delete this edit" onClick={onRemove}>
          <Trash2 className="size-4" />
        </Button>
      </div>
      <p className="-mt-2 text-xs text-muted-foreground" title={edit.by || undefined}>{describeAuthor(edit.by)}</p>

      <Field label="Starts at" value={`${edit.t.toFixed(2)}s`}>
        <Slider aria-label="Start time" aria-valuetext={`${edit.t.toFixed(2)} seconds`}
          min={0}
          max={Math.max(edit.t + 30, 60)}
          step={0.05}
          value={[edit.t]}
          onValueChange={(v) => patch({ t: num(v) })}
        />
      </Field>

      <Field label="Lasts" value={`${edit.d.toFixed(2)}s`}>
        {/* A music bed is as long as the video, so a slider that stopped at twelve seconds
            sat pinned at its far end and said the bed was twelve seconds long. */}
        <Slider aria-label="Duration" aria-valuetext={`${edit.d.toFixed(2)} seconds`} min={0.1} max={Math.max(12, Math.ceil(edit.d * 1.25))} step={0.05} value={[edit.d]} onValueChange={(v) => patch({ d: num(v) })} />
      </Field>

      {/* The everyday controls for a sound, where the sound is: pick it on the audio track
          and its level, its ducking and its looping are right here. */}
      {edit.type === "music" || edit.type === "sfx" ? (
        <Field label="Level" value={`${Math.round(edit.gain * 100)}%`}>
          <Slider aria-label="Level" aria-valuetext={`${Math.round(edit.gain * 100)} percent`} min={0} max={2} step={0.01} value={[edit.gain]} onValueChange={(v) => patch({ gain: num(v) } as Partial<Edit>)} />
        </Field>
      ) : null}

      {edit.type === "music" ? (
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap gap-4">
            <Checkbox className="text-xs" checked={edit.duck} onCheckedChange={(duck) => patch({ duck } as Partial<Edit>)}>Lower it under speech</Checkbox>
            <Checkbox className="text-xs" checked={edit.loop} onCheckedChange={(loop) => patch({ loop } as Partial<Edit>)}>Loop to fill the time</Checkbox>
          </div>
          <p className="text-[11px] text-muted-foreground">Ducking drops the bed while words are sounding, using the word timings. Without it the music fights the voice.</p>
        </div>
      ) : null}

      {edit.type === "punch" ? (
        <Field label="Zoom" value={`${edit.scale.toFixed(2)}×`}>
          <Slider aria-label="Zoom"
            min={1}
            max={1.6}
            step={0.01}
            value={[edit.scale]}
            onValueChange={(v) => patch({ scale: num(v) } as Partial<Edit>)}
          />
        </Field>
      ) : null}

      {edit.type === "emphasis" ? (
        <div className="flex flex-col gap-2">
          <Label className="text-xs text-muted-foreground">Words to highlight</Label>
          <Input aria-label="Words to highlight"
            value={edit.words.join(" ")}
            onChange={(e) =>
              patch({ words: e.target.value.split(/\s+/).filter(Boolean) } as Partial<Edit>)
            }
          />
          <ColorField
            label="Highlight colour"
            value={edit.color}
            onChange={(color) => patch({ color } as Partial<Edit>)}
          >Highlight colour</ColorField>
        </div>
      ) : null}

      {edit.type === "text" ? (
        <div className="flex flex-col gap-2">
          <Label className="text-xs text-muted-foreground">Title</Label>
          <Textarea aria-label="Title"
            rows={3}
            value={edit.text}
            onChange={(e) => patch({ text: e.target.value } as Partial<Edit>)}
          />
          <div className="flex gap-2">
            <Select value={edit.style} onValueChange={(v) => patch({ style: v } as Partial<Edit>)}>
              <SelectTrigger aria-label="Text style" className="flex-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="card">White card</SelectItem>
                <SelectItem value="plain">Plain text</SelectItem>
              </SelectContent>
            </Select>
            {/* A dragged title carries its own x/y; picking a preset again lets those go. */}
            <Select value={edit.y === null ? edit.position : "custom"} onValueChange={(v) => patch(v === "custom" ? { x: 0.5, y: PRESET_Y[edit.position] } as Partial<Edit> : { position: v, x: null, y: null } as Partial<Edit>)}>
              <SelectTrigger aria-label="Text position" className="flex-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="top">Top</SelectItem>
                <SelectItem value="center">Center</SelectItem>
                <SelectItem value="bottom">Bottom</SelectItem>
                <SelectItem value="custom">Custom</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {edit.y !== null ? (
            <>
              <Field label="Horizontal position" value={`${Math.round((edit.x ?? 0.5) * 100)}%`}>
                <Slider aria-label="Horizontal position" min={0} max={1} step={0.01} value={[edit.x ?? 0.5]} onValueChange={(v) => patch({ x: num(v) } as Partial<Edit>)} />
              </Field>
              <Field label="Vertical position" value={`${Math.round(edit.y * 100)}%`}>
                <Slider aria-label="Vertical position" min={0} max={1} step={0.01} value={[edit.y]} onValueChange={(v) => patch({ y: num(v) } as Partial<Edit>)} />
              </Field>
            </>
          ) : null}
        </div>
      ) : null}

      {edit.type === "image" ? (
        <div className="flex flex-col gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={assetUrl(projectId, edit.src)}
            alt=""
            className="w-full rounded-xl border border-border object-cover"
          />
          <Input aria-label="Image caption"
            value={edit.caption}
            onChange={(e) => patch({ caption: e.target.value } as Partial<Edit>)}
            placeholder="Caption (optional)"
          />
          <Field label="Width" value={`${Math.round(edit.widthPct)}%`}>
            <Slider aria-label="Image width"
              min={20}
              max={100}
              step={1}
              value={[edit.widthPct]}
              onValueChange={(v) => patch({ widthPct: num(v) } as Partial<Edit>)}
            />
          </Field>
          <Field label="Horizontal position" value={edit.x === null ? "Centred" : `${Math.round(edit.x * 100)}%`}>
            <Slider aria-label="Horizontal position"
              min={0}
              max={1}
              step={0.01}
              value={[edit.x ?? 0.5]}
              onValueChange={(v) => patch({ x: num(v) } as Partial<Edit>)}
            />
          </Field>
          <Field label="Vertical position" value={`${Math.round(edit.y * 100)}%`}>
            <Slider aria-label="Vertical position"
              min={0.05}
              max={0.95}
              step={0.01}
              value={[edit.y]}
              onValueChange={(v) => patch({ y: num(v) } as Partial<Edit>)}
            />
          </Field>
        </div>
      ) : null}
    </div>
  );
}

function Field({
  label,
  value,
  children,
}: {
  label: string;
  value: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label className="flex justify-between text-xs text-muted-foreground">
        {label} <span className="font-mono">{value}</span>
      </Label>
      {children}
    </div>
  );
}
