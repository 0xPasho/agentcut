"use client";
import { useId } from "react";
import type { SlotValue } from "@/lib/templates/plan";
import type { TemplateSlot } from "@/lib/templates/schema";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

/**
 * The inputs a rule hands to the template it applies.
 *
 * A rule that can name a template but not fill its slots can only ever choose somebody
 * else's assets, which is why "end every clip on my stream card" could not be written as
 * a rule. The agent can write these; so must this, or the two interfaces are not the
 * same editor.
 *
 * Only what is in the library is offered: a rule outlives the project it was written in,
 * and an asset that belongs to one project would be a dangling reference everywhere else.
 */
export type SlotAsset = { id: string; name: string; kind: string };

const KIND_LABEL: Record<string, string> = { image: "picture", video: "video", audio: "sound" };

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
      <legend className="text-sm font-medium">Fill this template&apos;s inputs</legend>
      <p className="text-xs text-muted-foreground">
        What the rule gives the template when it applies it — the card it ends on, the bed it plays under.
        Whoever runs the rule can still pass something else.
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
            {slot.kind === "text" ? (
              <Input id={`${id}-${slot.id}`} value={current?.text ?? ""} placeholder="Leave empty to skip it"
                onChange={(e) => set(slot.id, e.target.value.trim() ? { text: e.target.value } : null)} />
            ) : slot.kind === "imagePool" ? (
              <Input id={`${id}-${slot.id}`} value={current?.folder ?? ""} placeholder="~/Desktop/screenshots"
                onChange={(e) => set(slot.id, e.target.value.trim() ? { folder: e.target.value } : null)} />
            ) : (
              <Select value={current?.assetId ?? ""} onValueChange={(v) => set(slot.id, String(v) ? { assetId: String(v) } : null)}>
                <SelectTrigger aria-labelledby={`${id}-${slot.id}-label`} className="w-full">
                  <SelectValue>{(v: unknown) => choices.find((a) => a.id === v)?.name ?? "Whatever is passed when it runs"}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Whatever is passed when it runs</SelectItem>
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
