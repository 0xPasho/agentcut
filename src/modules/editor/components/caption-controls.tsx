"use client";

import { useId } from "react";
import { Label } from "@/common/ui/label";
import { Slider } from "@/common/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/common/ui/select";
import { ColorField } from "@/common/ui/color-field";
import type { CaptionStyle } from "@/modules/editor/types";

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
        <ColorField label="Caption text" value={value.color} onChange={(v) => set("color", v)}>Text</ColorField>
        <ColorField label="Caption highlight" value={value.highlight} onChange={(v) => set("highlight", v)}>Highlight</ColorField>
      </div>
    </div>
  );
}
