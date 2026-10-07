"use client";
import { useId } from "react";
import type { SlotValue } from "@agentcut/core/modules/templates/server/plan";
import type { TemplateSlot } from "@agentcut/core/modules/templates/types";
import { Button } from "../../../common/ui/button";
import { Input } from "../../../common/ui/input";
import { Label } from "../../../common/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../common/ui/select";
import { type SlotAsset } from "@agentcut/core/modules/rules/types";
import { KIND_LABEL } from "@agentcut/core/modules/rules/data";

export function RuleSlots({ slots, assets, value, onChange }: {
  slots: TemplateSlot[];
  assets: SlotAsset[];
  value: Record<string, SlotValue>;
  onChange: (next: Record<string, SlotValue>) => void;
}) {
  const id = useId();
  if (!slots.length) return null;
  const set = (slot: string, next: SlotValue | null) => {
    const copy = { ...value };
    if (next) copy[slot] = next; else delete copy[slot];
    onChange(copy);
  };

  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">Files and text for this template</legend>
      <p className="text-xs text-muted-foreground">
        Choose the ending video, music or text this rule should use. Required inputs must be
        supplied here or when the template is applied.
      </p>
      {slots.map((slot) => {
        const current = value[slot.id];
        const wanted = slot.kind === "audio" ? "audio" : slot.kind === "video" ? "video" : "image";
        const choices = assets.filter((asset) => asset.kind === wanted);
        return (
          <div key={slot.id} className="space-y-1">
            <Label htmlFor={`${id}-${slot.id}`} id={`${id}-${slot.id}-label`} className="text-xs text-muted-foreground">
              {slot.label}{slot.required ? " (required)" : ""}
            </Label>
            {slot.kind === "text" && (
              <Input id={`${id}-${slot.id}`} value={current?.text ?? ""} placeholder="Leave empty to skip it"
                onChange={(e) => set(slot.id, e.target.value.trim() ? { text: e.target.value } : null)} />
            )}
            {slot.kind === "imagePool" && (
              <div className="space-y-2">
                <Input id={`${id}-${slot.id}`} value={current?.folder ?? ""} placeholder="Folder of pictures (optional)"
                  onChange={(e) => set(slot.id, { ...current, folder: e.target.value || undefined })} />
                <p className="text-xs text-muted-foreground">Choose library pictures in order, or use a folder. Selected pictures take priority over the folder.</p>
                {(current?.assetIds ?? []).map((assetId, index, all) => <div key={`${index}-${assetId}`} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="min-w-0 flex-1 break-words">{index + 1}. {assets.find(a => a.id === assetId)?.name ?? assetId}</span>
                  <Button type="button" variant="ghost" size="xs" disabled={index === 0} aria-label={`Move picture ${index + 1} earlier`} onClick={() => { const next = [...all]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; set(slot.id, { ...current, assetIds: next }); }}>Move up</Button>
                  <Button type="button" variant="ghost" size="xs" onClick={() => set(slot.id, { ...current, assetIds: all.filter((_, i) => i !== index) })}>Remove picture {index + 1}</Button>
                </div>)}
                <label className="block space-y-1 text-sm" htmlFor={`${id}-${slot.id}-picture`}><span id={`${id}-${slot.id}-picture-label`}>Add a library picture</span>
                  <select id={`${id}-${slot.id}-picture`} aria-labelledby={`${id}-${slot.id}-picture-label`} value="" className="h-10 w-full rounded-lg border border-border bg-background px-2 text-base sm:text-sm focus-visible:outline-2 focus-visible:outline-ring" onChange={e => { if (e.target.value) set(slot.id, { ...current, assetIds: [...(current?.assetIds ?? []), e.target.value] }); }}>
                    <option value="">Choose a picture…</option>{choices.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </label>
              </div>
            )}
            {slot.kind !== "text" && slot.kind !== "imagePool" && (
              <Select value={current?.assetId ?? ""} onValueChange={(v) => set(slot.id, String(v) ? { assetId: String(v) } : null)}>
                <SelectTrigger aria-labelledby={`${id}-${slot.id}-label`} className="w-full">
                  <SelectValue>{(v: unknown) => choices.find((a) => a.id === v)?.name ?? (v ? `${String(v)} (not in library)` : "No file specified")}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">No file specified</SelectItem>
                  {current?.assetId && !choices.some(a => a.id === current.assetId) && <SelectItem value={current.assetId}>{current.assetId} (not in library)</SelectItem>}
                  {choices.length
                    ? choices.map((asset) => <SelectItem key={asset.id} value={asset.id}>{asset.name}</SelectItem>)
                    : <SelectItem value="" disabled>Add a {KIND_LABEL[slot.kind] ?? slot.kind} to the library first</SelectItem>}
                </SelectContent>
              </Select>
            )}
            {slot.description && <p className="text-xs leading-relaxed text-muted-foreground">{slot.description}</p>}
          </div>
        );
      })}
    </fieldset>
  );
}
