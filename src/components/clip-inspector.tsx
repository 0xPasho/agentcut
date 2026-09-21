"use client";

import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { assetUrl } from "@/lib/client";
import type { Edit } from "@/lib/edl";
import { describeAuthor } from "@/lib/editor/authorship";

const num = (v: number | readonly number[]) => (Array.isArray(v) ? v[0] : (v as number));
/** Where each preset's block roughly centres, so switching to a free position starts from there. */
const PRESET_Y = { top: 0.15, center: 0.5, bottom: 0.78 } as const;

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
        <Slider aria-label="Duration" aria-valuetext={`${edit.d.toFixed(2)} seconds`} min={0.1} max={12} step={0.05} value={[edit.d]} onValueChange={(v) => patch({ d: num(v) })} />
      </Field>

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
          <Input
            aria-label="Highlight color" type="color"
            value={edit.color}
            onChange={(e) => patch({ color: e.target.value } as Partial<Edit>)}
            className="h-9 cursor-pointer p-1"
          />
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
