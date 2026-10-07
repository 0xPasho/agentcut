"use client";

import * as React from "react";
import { Slider as SliderPrimitive } from "@base-ui/react/slider";
import { Pipette } from "lucide-react";
import { cn } from "cn";
import { Input } from "./input";
import { Label } from "./label";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";

/**
 * Colour, picked inside the app.
 *
 * `<input type="color">` opens the operating system's own window: a light grey panel
 * with system type and system controls, over a near-black editor. It is also the one
 * control the theme cannot reach — no radius, no ring, no focus of ours. So the swatch
 * here is a button, and what it opens is this panel, in the same material as every
 * other one.
 *
 * Every path to a colour is here: the shade area for the eye, the hue rail and the hex
 * box for the keyboard, and the template's own swatches for the ones that are already
 * the brand. The value in and out is a `#rrggbb` string, exactly as before, so the EDL
 * and the agent see no difference.
 */

const clamp = (n: number, min = 0, max = 1) => Math.min(max, Math.max(min, n));

/** Black ink on a light colour, white on a dark one — the swatch's mark has to survive both. */
function inkOn(hex: string) {
  const [r, g, b] = hexToRgb(hex);
  return (r * 299 + g * 587 + b * 114) / 1000 > 140 ? "text-black/50" : "text-white/70";
}

export function normalizeHex(input: string, fallback = "#000000") {
  const hex = input.trim().replace(/^#?/, "");
  if (/^[0-9a-f]{3}$/i.test(hex)) return `#${hex.split("").map(c => c + c).join("")}`.toLowerCase();
  if (/^[0-9a-f]{6}$/i.test(hex)) return `#${hex}`.toLowerCase();
  return fallback;
}

function hexToRgb(hex: string) {
  const value = normalizeHex(hex).slice(1);
  return [0, 2, 4].map(i => parseInt(value.slice(i, i + 2), 16)) as [number, number, number];
}

function rgbToHex(r: number, g: number, b: number) {
  return `#${[r, g, b].map(c => Math.round(clamp(c, 0, 255)).toString(16).padStart(2, "0")).join("")}`;
}

/** Hue in degrees, saturation and value from 0 to 1. */
export function hexToHsv(hex: string) {
  const [r, g, b] = hexToRgb(hex).map(c => c / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d) {
    h = max === r ? 60 * (((g - b) / d) % 6) : max === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4);
    if (h < 0) h += 360;
  }
  return { h, s: max ? d / max : 0, v: max };
}

export function hsvToHex(h: number, s: number, v: number) {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return 255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1)));
  };
  return rgbToHex(f(5), f(3), f(1));
}

/**
 * The panel itself, for the rare caller that already has a surface to put it on.
 * Everything else wants `<ColorField>`, which brings the swatch and the popover.
 */
export function ColorPicker({
  value,
  onChange,
  swatches,
  label,
  className,
}: {
  value: string;
  onChange: (hex: string) => void;
  /** Colours worth one click — usually the active template's brand kit. */
  swatches?: string[];
  /** What this colour is for, so the hex box and the rail can say it. */
  label: string;
  className?: string;
}) {
  const hex = normalizeHex(value);
  const hsv = hexToHsv(hex);
  // A black or grey value carries no hue of its own, so the rail keeps the last one
  // rather than snapping back to red the moment the shade area reaches a corner.
  const [lastHue, setLastHue] = React.useState(hsv.h);
  const hue = hsv.s === 0 || hsv.v === 0 ? lastHue : hsv.h;
  const [draft, setDraft] = React.useState<string | null>(null);
  const pad = React.useRef<HTMLDivElement>(null);
  const hexId = React.useId();

  const pick = (event: React.PointerEvent) => {
    const box = pad.current?.getBoundingClientRect();
    if (!box) return;
    onChange(hsvToHex(hue, clamp((event.clientX - box.left) / box.width), 1 - clamp((event.clientY - box.top) / box.height)));
  };

  return (
    <div className={cn("flex w-56 flex-col gap-3", className)}>
      {/* Pointer-only, and deliberately invisible to assistive tech: it is a shortcut to
          the same colour the rail and the hex box below set, not a third value. */}
      <div
        ref={pad}
        aria-hidden
        onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); pick(event); }}
        onPointerMove={event => { if (event.buttons) pick(event); }}
        className="relative h-28 w-full cursor-crosshair touch-none rounded-xl ring-1 ring-foreground/15 ring-inset"
        style={{
          backgroundImage:
            "linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent)",
          backgroundColor: hsvToHex(hue, 1, 1),
        }}
      >
        <span
          className="pointer-events-none absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgb(0_0_0/0.5)]"
          style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, backgroundColor: hex }}
        />
      </div>

      <SliderPrimitive.Root
        value={Math.round(hue)}
        min={0}
        max={359}
        thumbAlignment="edge"
        onValueChange={next => {
          const h = Array.isArray(next) ? next[0] : next;
          setLastHue(h);
          onChange(hsvToHex(h, hsv.s || 1, hsv.v || 1));
        }}
      >
        <SliderPrimitive.Control className="relative flex min-h-6 w-full touch-none items-center select-none">
          <SliderPrimitive.Track
            className="relative h-2.5 w-full grow rounded-full ring-1 ring-foreground/15 ring-inset"
            style={{
              backgroundImage:
                "linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%)",
            }}
          >
            <SliderPrimitive.Indicator className="h-full bg-transparent" />
          </SliderPrimitive.Track>
          <SliderPrimitive.Thumb
            aria-label={`${label} hue`}
            aria-valuetext={`${Math.round(hue)} degrees`}
            className="relative block size-4 shrink-0 rounded-full border-2 border-white shadow-[0_1px_4px_rgb(0_0_0/0.6)] ring-ring/50 outline-hidden after:absolute after:-inset-2 focus-visible:ring-3"
            style={{ backgroundColor: hsvToHex(hue, 1, 1) }}
          />
        </SliderPrimitive.Control>
      </SliderPrimitive.Root>

      {swatches?.length ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {swatches.map(swatch => (
            <button
              key={swatch}
              type="button"
              aria-label={`${label}: ${swatch}`}
              aria-pressed={normalizeHex(swatch) === hex}
              onClick={() => { setDraft(null); onChange(normalizeHex(swatch)); }}
              className={cn(
                "size-6 rounded-full transition-transform duration-150 outline-none hover:scale-110 focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none",
                normalizeHex(swatch) === hex ? "ring-2 ring-white" : "ring-1 ring-foreground/25",
              )}
              style={{ backgroundColor: swatch }}
            />
          ))}
        </div>
      ) : null}

      <div className="flex items-center gap-2">
        <Label htmlFor={hexId} className="text-[11px] text-muted-foreground">Hex</Label>
        <Input
          id={hexId}
          value={draft ?? hex}
          spellCheck={false}
          autoComplete="off"
          aria-label={`${label}, hex value`}
          className="h-8 flex-1 font-mono text-xs"
          // Typed characters stand while they are still half a colour, and the value
          // only moves once six digits are there. Leaving the box tidies it up.
          onChange={event => {
            setDraft(event.target.value);
            const next = normalizeHex(event.target.value, "");
            if (next) { setLastHue(hexToHsv(next).h); onChange(next); }
          }}
          onBlur={() => setDraft(null)}
        />
      </div>
    </div>
  );
}

/**
 * The swatch that opens the picker. `children` is the word beside it; without one the
 * button still names the colour it holds for anyone who cannot see it.
 */
export function ColorField({
  value,
  onChange,
  label,
  swatches,
  className,
  swatchClassName,
  children,
  align = "start",
  side = "top",
}: {
  value: string;
  onChange: (hex: string) => void;
  label: string;
  swatches?: string[];
  className?: string;
  swatchClassName?: string;
  children?: React.ReactNode;
  align?: "start" | "center" | "end";
  side?: "top" | "bottom" | "left" | "right";
}) {
  const hex = normalizeHex(value);
  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label={children ? undefined : `${label}: ${hex}`}
            title={`${label}: ${hex}`}
            className={cn(
              "inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-full text-xs text-muted-foreground transition-colors duration-150 outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none",
              className,
            )}
          >
            <span
              aria-hidden
              className={cn(
                "grid size-6 shrink-0 place-items-center rounded-full ring-1 ring-foreground/25 shadow-[inset_0_1px_2px_rgb(0_0_0/0.4)]",
                inkOn(hex),
                swatchClassName,
              )}
              style={{ backgroundColor: hex }}
            >
              <Pipette className="size-3" />
            </span>
            {children}
          </button>
        }
      />
      <PopoverContent side={side} align={align} className="w-auto" aria-label={label}>
        <ColorPicker value={hex} onChange={onChange} label={label} swatches={swatches} />
      </PopoverContent>
    </Popover>
  );
}
