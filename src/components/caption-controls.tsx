"use client";

import { useId } from "react";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import type { CaptionStyle } from "@/lib/edl";

const asNumber = (v: number | readonly number[]) => (Array.isArray(v) ? v[0] : (v as number));

const PRESETS: CaptionStyle["preset"][] = ["karaoke", "popline", "boxed", "none"];

export function CaptionControls({
  value,
  onChange,
}: {
  value: CaptionStyle;
  onChange: (next: CaptionStyle) => void;
}) {
  const id = useId();
  const set = <K extends keyof CaptionStyle>(key: K, v: CaptionStyle[K]) =>
    onChange({ ...value, [key]: v });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label id={`${id}-style`} className="text-xs text-muted-foreground">Style</Label>
        <Select value={value.preset} onValueChange={(v) => set("preset", v as CaptionStyle["preset"])}>
          <SelectTrigger aria-labelledby={`${id}-style`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PRESETS.map((p) => (
              <SelectItem key={p} value={p} className="capitalize">
                {p}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-2">
        <Label id={`${id}-size`} className="flex justify-between text-xs text-muted-foreground">
          Size <span className="font-mono">{value.fontSizePct.toFixed(1)}%</span>
        </Label>
        <Slider
          aria-labelledby={`${id}-size`}
          aria-valuetext={`${value.fontSizePct.toFixed(1)} percent`}
          min={3}
          max={14}
          step={0.5}
          value={[value.fontSizePct]}
          onValueChange={(v) => set("fontSizePct", asNumber(v))}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label id={`${id}-position`} className="flex justify-between text-xs text-muted-foreground">
          Position <span className="font-mono">{Math.round(value.positionY * 100)}%</span>
        </Label>
        <Slider
          aria-labelledby={`${id}-position`}
          aria-valuetext={`${Math.round(value.positionY * 100)} percent`}
          min={0.15}
          max={0.92}
          step={0.01}
          value={[value.positionY]}
          onValueChange={(v) => set("positionY", asNumber(v))}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label id={`${id}-words`} className="flex justify-between text-xs text-muted-foreground">
          Words per line <span className="font-mono">{value.maxWordsPerLine}</span>
        </Label>
        <Slider
          aria-labelledby={`${id}-words`}
          aria-valuetext={`${value.maxWordsPerLine} words`}
          min={1}
          max={8}
          step={1}
          value={[value.maxWordsPerLine]}
          onValueChange={(v) => set("maxWordsPerLine", asNumber(v))}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label id={`${id}-sync`} className="flex justify-between text-xs text-muted-foreground">
          Sync{" "}
          <span className="font-mono">
            {value.syncOffsetMs > 0 ? "+" : ""}
            {value.syncOffsetMs} ms
          </span>
        </Label>
        <Slider
          aria-labelledby={`${id}-sync`}
          aria-valuetext={`${value.syncOffsetMs} milliseconds`}
          min={-500}
          max={500}
          step={10}
          value={[value.syncOffsetMs]}
          onValueChange={(v) => set("syncOffsetMs", asNumber(v))}
        />
      </div>

      <div className="flex items-center gap-5">
        <Swatch label="Text" value={value.color} onChange={(v) => set("color", v)} />
        <Swatch label="Highlight" value={value.highlight} onChange={(v) => set("highlight", v)} />
      </div>
    </div>
  );
}

/** A native colour input reads as a raw form control; this is just the swatch. */
function Swatch({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="relative flex min-h-9 cursor-pointer items-center gap-2 rounded-full text-xs text-muted-foreground has-focus-visible:ring-2 has-focus-visible:ring-ring has-focus-visible:ring-offset-4 has-focus-visible:ring-offset-background">
      <span
        className="size-6 rounded-full border border-white/20 shadow-[inset_0_1px_2px_rgba(0,0,0,0.4)]"
        style={{ backgroundColor: value }}
      />
      {label}
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="sr-only"
      />
    </label>
  );
}
