"use client";

import { Copy, Music2, Palette, Plus, Scissors, Trash2, Type, Volume2, VolumeX } from "lucide-react";
import { Button } from "@/common/ui/button";
import { Input } from "@/common/ui/input";
import { Label } from "@/common/ui/label";
import { ColorField } from "@/common/ui/color-field";
import { Popover, PopoverContent, PopoverTrigger } from "@/common/ui/popover";
import { shotName } from "@/modules/editor/lib/canvas";
import { usePlayheadSelector } from "@/modules/editor/hooks/playhead";
import type { Clip, Edit, SequenceItem, TextEdit } from "@/modules/editor/types";
import { DEFAULT_PALETTE, POSITION_LABELS } from "../data";


/**
 * The selected clip's own actions: its words, the colours, mute, separate audio, split,
 * duplicate, remove. They sit in a bar under the frame rather than on top of it — the
 * picture is where the layers are dragged, and a floating control there covers the very
 * thing it is meant to edit.
 *
 * Every button here dispatches the same shared operation its panel equivalent does; this is
 * a shortcut to the editor, not a second one.
 *
 * There is no "hook" here any more. A hook is a title that happens to come first: the model
 * has only ever had `text` edits and a clip has always been allowed as many as it likes —
 * the agent writes several routinely — but this bar showed `edits.find(text)`, so the
 * second one was invisible and unreachable and the first one looked like a different kind
 * of thing. A hook is still a hook where it means something: the shot a template names
 * "Hook", and the line the stream's opening comment waits for.
 */
export function ClipToolbar({
  item, clip, palette = DEFAULT_PALETTE, span, canDetach,
  onChange, onMute, onSplit, onDuplicate, onDetachAudio, onRemove, onAddText,
}: {
  item: SequenceItem;
  clip: Clip;
  /** Swatches offered for the titles and the captions, usually the active template's brand kit. */
  palette?: string[];
  /**
   * Where this clip sits on the programme, in output seconds, or null when it is not
   * placed. Split needs the playhead inside it, and a button that is always live and
   * then refuses is a button that taught nobody anything.
   */
  span: { from: number; until: number } | null;
  canDetach: boolean;
  onChange: (clip: Clip) => void;
  onMute: (muted: boolean) => void;
  onSplit: () => void;
  onDuplicate: () => void;
  onDetachAudio: () => void;
  onRemove: () => void;
  /**
   * Add one more line. The view decides where it lands, because that depends on what is
   * picked: inside a shot that has footage, or as a scene of its own beside the titles
   * already on the timeline.
   */
  onAddText: () => void;
}) {
  const canSplit = usePlayheadSelector(seconds => !!span && seconds > span.from + .02 && seconds < span.until - .02);
  /** Every line on this clip, each with the index it holds among all of its edits. */
  const texts = clip.edits.flatMap((edit, index) => edit.type === "text" ? [{ edit: edit as TextEdit, index }] : []);

  const setText = (index: number, patch: Partial<TextEdit>) =>
    onChange({ ...clip, edits: clip.edits.map((edit, at) => at === index ? { ...edit, ...patch } as TextEdit : edit) });
  const removeText = (index: number) =>
    onChange({ ...clip, edits: clip.edits.filter((_, at) => at !== index) });
  /** The quick colours are the clip's, not one line's: per-line control lives in the panel. */
  const setEveryText = (patch: Partial<TextEdit>) =>
    onChange({ ...clip, edits: clip.edits.map(edit => edit.type === "text" ? { ...edit, ...patch } as TextEdit : edit) });
  const first = texts[0]?.edit;
  const carded = texts.some(({ edit }) => edit.style === "card");

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
        {/* The seventh slot is any colour at all, in a panel of ours rather than the
            operating system's window. The six above are already one click away, so it
            does not repeat them. */}
        <ColorField label={`${label}, any colour`} value={current} onChange={apply} side="right" align="start" />
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
            <Button size="xs" variant={texts.length ? "secondary" : "ghost"} title="The words on top of the video">
              <Type />Text{texts.length > 1 ? <span className="tabular-nums text-muted-foreground">{texts.length}</span> : null}
            </Button>
          }
        />
        {/* Tall enough for a few lines and then it scrolls, rather than growing off the screen. */}
        <PopoverContent className="max-h-[min(24rem,60dvh)] w-80 space-y-3 overflow-y-auto">
          {texts.length === 0
            ? <p className="text-xs text-muted-foreground">Nothing is written on this clip yet.</p>
            : texts.map(({ edit, index }, position) => (
              <div key={index} className="space-y-1.5 border-s border-foreground/10 ps-2.5">
                <div className="flex items-center gap-1.5">
                  <Input
                    aria-label={texts.length > 1 ? `Text ${position + 1}` : "Text"}
                    value={edit.text}
                    autoFocus={position === 0}
                    placeholder="The line that stops the scroll"
                    onChange={e => setText(index, { text: e.target.value })}
                  />
                  <Button size="icon-xs" variant="ghost" aria-label={`Remove text ${position + 1}`} title="Remove this text" onClick={() => removeText(index)}><Trash2 /></Button>
                </div>
                <div className="flex gap-1">
                  {(["top", "center", "bottom"] as const).map(place => (
                    <Button
                      key={place}
                      size="xs"
                      variant={edit.position === place && edit.y === null ? "secondary" : "outline"}
                      aria-pressed={edit.position === place && edit.y === null}
                      // Choosing a preset gives up the free placement a drag on the frame wrote,
                      // which is the only way back to it once something has been moved by hand.
                      onClick={() => setText(index, { position: place, x: null, y: null })}
                    >{POSITION_LABELS[place]}</Button>
                  ))}
                </div>
              </div>
            ))}
          <Button size="xs" variant="outline" className="w-full" onClick={onAddText}><Plus />Add text</Button>
          <p className="text-[11px] text-muted-foreground">Drag one on the frame to place it anywhere.</p>
        </PopoverContent>
      </Popover>

      <Popover>
        <PopoverTrigger render={<Button size="xs" variant="ghost" title="Caption colours"><Palette />Colours</Button>} />
        <PopoverContent className="w-72 space-y-3">
          {swatches("Highlight", clip.captions.highlight, highlight => onChange({ ...clip, captions: { ...clip.captions, highlight } }))}
          {swatches("Caption text", clip.captions.color, color => onChange({ ...clip, captions: { ...clip.captions, color } }))}
          {first ? swatches(texts.length > 1 ? "Every text on this clip" : "Text", first.color || (first.style === "card" ? "#000000" : "#ffffff"), color => setEveryText({ color })) : null}
          {first && carded ? swatches("Text background", first.background || "#ffffff", background => setEveryText({ background })) : null}
        </PopoverContent>
      </Popover>

      <span aria-hidden className="mx-0.5 h-5 w-px bg-white/10" />

      <Button size="xs" variant="ghost" aria-label={item.muted ? "Unmute this clip" : "Mute this clip"} title={item.muted ? "Unmute this clip" : "Mute this clip"} onClick={() => onMute(!item.muted)}>
        {item.muted ? <VolumeX /> : <Volume2 />}
      </Button>
      {canDetach ? <Button size="xs" variant="ghost" aria-label="Separate this clip's audio" title="Put this clip's sound on its own track" onClick={onDetachAudio}><Music2 /></Button> : null}
      <Button size="xs" variant="ghost" disabled={!canSplit} aria-label={canSplit ? "Split at the playhead" : "Split — move the playhead into this clip first"} title={canSplit ? "Split at the playhead (S)" : "Move the playhead into this clip to split it (S)"} onClick={onSplit}><Scissors /></Button>
      <Button size="xs" variant="ghost" aria-label="Duplicate this clip" title="Duplicate (D)" onClick={onDuplicate}><Copy /></Button>
      <Button size="xs" variant="ghost" aria-label="Remove this clip" title="Remove from the timeline" onClick={onRemove}><Trash2 /></Button>
    </div>
  );
}
