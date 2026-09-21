"use client";

import { useState } from "react";
import { Copy, Music2, Palette, Scissors, Trash2, Type, Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { shotName } from "@/lib/editor/canvas";
import type { Clip, Edit, SequenceItem } from "@/lib/edl";

type TextEdit = Extract<Edit, { type: "text" }>;

/** When a template carries no brand kit, these are the colours a hook and a caption reach for. */
export const DEFAULT_PALETTE = ["#ffe600", "#ffffff", "#000000", "#ff4d4d", "#4dd4ff", "#7cff6b"];

/** The bar keeps its height with nothing selected, so picking a clip never resizes the frame. */
export const TOOLBAR_ROW = "flex min-h-11 shrink-0 items-center justify-center";

/**
 * The selected clip's own actions: the hook, the colours, mute, separate audio, split,
 * duplicate, remove. They sit in a bar under the frame rather than on top of it — the
 * picture is where the layers are dragged, and a floating control there covers the very
 * thing it is meant to edit.
 *
 * Every button here dispatches the same shared operation its panel equivalent does; this is
 * a shortcut to the editor, not a second one.
 */
export function ClipToolbar({
  item, clip, palette = DEFAULT_PALETTE, canSplit, canDetach,
  onChange, onMute, onSplit, onDuplicate, onDetachAudio, onRemove,
}: {
  item: SequenceItem;
  clip: Clip;
  /** Swatches offered for the hook and the captions, usually the active template's brand kit. */
  palette?: string[];
  canSplit: boolean;
  canDetach: boolean;
  onChange: (clip: Clip) => void;
  onMute: (muted: boolean) => void;
  onSplit: () => void;
  onDuplicate: () => void;
  onDetachAudio: () => void;
  onRemove: () => void;
}) {
  const hook = clip.edits.find((e): e is TextEdit => e.type === "text");
  const hookIndex = clip.edits.findIndex(e => e.type === "text");
  const [draft, setDraft] = useState(hook?.text ?? "");

  const setHook = (text: string) => {
    setDraft(text);
    const next: TextEdit = {
      type: "text", t: hook?.t ?? 0, d: hook?.d ?? 2.5, text,
      position: hook?.position ?? "top", x: hook?.x ?? null, y: hook?.y ?? null,
      style: hook?.style ?? "card", by: hook?.by ?? "",
    };
    if (hookIndex < 0) { if (text.trim()) onChange({ ...clip, edits: [...clip.edits, next] }); return; }
    onChange({ ...clip, edits: clip.edits.flatMap((edit, index) => index !== hookIndex ? [edit] : text.trim() ? [next] : []) });
  };

  const swatches = (label: string, current: string, apply: (color: string) => void) => (
    <div className="flex flex-col gap-1.5">
      <Label className="text-[11px] text-muted-foreground">{label}</Label>
      <div className="flex flex-wrap items-center gap-1.5">
        {palette.map(color => (
          <button
            key={`${label}-${color}`}
            type="button"
            aria-label={`${label}: ${color}`}
            aria-pressed={current.toLowerCase() === color.toLowerCase()}
            onClick={() => apply(color)}
            className={`size-6 rounded-full border transition-transform duration-150 motion-reduce:transition-none hover:scale-110 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none ${current.toLowerCase() === color.toLowerCase() ? "border-white ring-2 ring-white/70" : "border-white/25"}`}
            style={{ backgroundColor: color }}
          />
        ))}
        <input
          type="color"
          aria-label={`${label}, custom colour`}
          value={current}
          onChange={e => apply(e.target.value)}
          className="size-6 cursor-pointer rounded-full border border-white/25 bg-transparent p-0"
        />
      </div>
    </div>
  );

  return (
    // The radius is half the height of the single row this almost always is, and still holds
    // its corners when a narrow window wraps it onto a second one.
    <div
      role="toolbar"
      aria-label={`${shotName(item)} controls`}
      className="flex w-fit max-w-full flex-wrap items-center gap-1 rounded-[20px] bg-card px-2 py-1.5 ring-1 ring-foreground/10"
    >
      {/* Off the picture, the bar has to say what it is pointed at. */}
      <span className="min-w-0 max-w-32 shrink truncate px-1.5 text-xs text-muted-foreground" title={shotName(item)}>{shotName(item)}</span>

      <Popover>
        <PopoverTrigger
          render={
            <Button size="xs" variant={hook ? "secondary" : "ghost"} title="The line on top of the video">
              <Type />Hook
            </Button>
          }
        />
        <PopoverContent className="w-72 space-y-3">
          <Label htmlFor="quick-hook" className="text-xs">Hook</Label>
          <Input
            id="quick-hook"
            value={draft}
            autoFocus
            placeholder="The line that stops the scroll"
            onChange={e => setHook(e.target.value)}
          />
          {hook ? (
            <div className="flex gap-1">
              {(["top", "center", "bottom"] as const).map(position => (
                <Button
                  key={position}
                  size="xs"
                  variant={hook.position === position ? "secondary" : "outline"}
                  aria-pressed={hook.position === position}
                  onClick={() => onChange({ ...clip, edits: clip.edits.map((edit, index) => index === hookIndex ? { ...hook, position, y: null } : edit) })}
                >{position}</Button>
              ))}
            </div>
          ) : null}
          <p className="text-[11px] text-muted-foreground">Drag it on the frame to place it anywhere.</p>
        </PopoverContent>
      </Popover>

      <Popover>
        <PopoverTrigger render={<Button size="xs" variant="ghost" title="Caption colours"><Palette />Colours</Button>} />
        <PopoverContent className="w-72 space-y-3">
          {swatches("Highlight", clip.captions.highlight, highlight => onChange({ ...clip, captions: { ...clip.captions, highlight } }))}
          {swatches("Caption text", clip.captions.color, color => onChange({ ...clip, captions: { ...clip.captions, color } }))}
        </PopoverContent>
      </Popover>

      <span aria-hidden className="mx-0.5 h-5 w-px bg-white/10" />

      <Button size="xs" variant="ghost" aria-label={item.muted ? "Unmute this clip" : "Mute this clip"} title={item.muted ? "Unmute this clip" : "Mute this clip"} onClick={() => onMute(!item.muted)}>
        {item.muted ? <VolumeX /> : <Volume2 />}
      </Button>
      {canDetach ? <Button size="xs" variant="ghost" aria-label="Separate this clip's audio" title="Put this clip's sound on its own track" onClick={onDetachAudio}><Music2 /></Button> : null}
      <Button size="xs" variant="ghost" disabled={!canSplit} aria-label="Split at the playhead" title="Split at the playhead (S)" onClick={onSplit}><Scissors /></Button>
      <Button size="xs" variant="ghost" aria-label="Duplicate this clip" title="Duplicate (D)" onClick={onDuplicate}><Copy /></Button>
      <Button size="xs" variant="ghost" aria-label="Remove this clip" title="Remove from the timeline" onClick={onRemove}><Trash2 /></Button>
    </div>
  );
}
