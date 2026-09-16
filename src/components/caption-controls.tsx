"use client";

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
  const set = <K extends keyof CaptionStyle>(key: K, v: CaptionStyle[K]) =>
    onChange({ ...value, [key]: v });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label className="text-xs text-muted-foreground">Style</Label>
        <Select value={value.preset} onValueChange={(v) => set("preset", v as CaptionStyle["preset"])}>
          <SelectTrigger className="w-full">
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
        <Label className="flex justify-between text-xs text-muted-foreground">
          Size <span className="font-mono">{value.fontSizePct.toFixed(1)}%</span>
        </Label>
        <Slider
          min={3}
          max={14}
          step={0.5}
          value={[value.fontSizePct]}
          onValueChange={(v) => set("fontSizePct", asNumber(v))}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label className="flex justify-between text-xs text-muted-foreground">
          Position <span className="font-mono">{Math.round(value.positionY * 100)}%</span>
        </Label>
        <Slider
          min={0.15}
          max={0.92}
          step={0.01}
          value={[value.positionY]}
          onValueChange={(v) => set("positionY", asNumber(v))}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label className="flex justify-between text-xs text-muted-foreground">
          Words per line <span className="font-mono">{value.maxWordsPerLine}</span>
        </Label>
        <Slider
          min={1}
          max={8}
          step={1}
          value={[value.maxWordsPerLine]}
          onValueChange={(v) => set("maxWordsPerLine", asNumber(v))}
        />
      </div>

      <div className="flex items-end gap-3">
        <div className="flex flex-1 flex-col gap-2">
          <Label className="text-xs text-muted-foreground">Text</Label>
          <Input
            type="color"
            value={value.color}
            onChange={(e) => set("color", e.target.value)}
            className="h-9 w-full cursor-pointer p-1"
          />
        </div>
        <div className="flex flex-1 flex-col gap-2">
          <Label className="text-xs text-muted-foreground">Highlight</Label>
          <Input
            type="color"
            value={value.highlight}
            onChange={(e) => set("highlight", e.target.value)}
            className="h-9 w-full cursor-pointer p-1"
          />
        </div>
      </div>
    </div>
  );
}
