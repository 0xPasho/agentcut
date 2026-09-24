"use client";

import { useState, useTransition } from "react";
import { ImagePlus, Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/common/ui/button";
import { Input } from "@/common/ui/input";
import { Label } from "@/common/ui/label";
import { Slider } from "@/common/ui/slider";
import { Textarea } from "@/common/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/common/ui/select";
import { api, assetUrl } from "@/common/api/client";
import { ProjectAssets } from "../../media/components/project-assets";
import { ImageSearch } from "@/modules/media/components/image-search";
import { AudioPicker } from "@/modules/media/components/audio-picker";
import { fmt } from "@/modules/transcription/lib/transcript";
import type { Clip, Edit, TextEdit, ImageEdit } from "@/modules/editor/types";
import { num, parseTime } from "../lib/overlay-editor";


export function OverlayEditor({
  projectId,
  mediaId,
  canCapture = true,
  clip,
  atSec = () => 0,
  onChange,
  onPlaceBed,
  onAddText,
}: {
  projectId: string;
  mediaId?: string;
  canCapture?: boolean;
  clip: Clip;
  /** One more line. The view decides whether it goes inside this shot or beside it. */
  onAddText?: () => void;
  /** Put a music bed on the audio track instead of inside this shot. */
  onPlaceBed?: (assetId: string) => void;
  /** Where new overlays land, clip-relative. Read when one is added, so a playing
      preview never re-renders this panel just to keep the number current. */
  atSec?: () => number;
  onChange: (edits: Edit[]) => void;
}) {
  const [at, setAt] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  /** Every line on this clip, each with the index it holds among all of its edits. */
  const texts = clip.edits.flatMap((edit, index) => edit.type === "text" ? [{ edit: edit as TextEdit, index }] : []);
  const images = clip.edits.filter((e): e is ImageEdit => e.type === "image");

  const setText = (index: number, patch: Partial<TextEdit>) =>
    onChange(clip.edits.map((edit, at) => at === index ? { ...edit, ...patch } as TextEdit : edit));
  const removeText = (index: number) => onChange(clip.edits.filter((_, at) => at !== index));

  const patchImage = (index: number, patch: Partial<ImageEdit>) => {
    let seen = -1;
    onChange(
      clip.edits.map((e) => {
        if (e.type !== "image") return e;
        seen += 1;
        return seen === index ? { ...e, ...patch } : e;
      }),
    );
  };

  const removeImage = (index: number) => {
    let seen = -1;
    onChange(
      clip.edits.filter((e) => {
        if (e.type !== "image") return true;
        seen += 1;
        return seen !== index;
      }),
    );
  };

  /** Times are clip-relative, but the capture reads from the full source. */
  const addImage = () => {
    if (!canCapture) return setError("This canvas scene has no source video. Import an image below instead.");
    const rel = parseTime(at);
    if (rel === null) return setError("Use seconds or m:ss");
    setError(null);
    start(async () => {
      try {
        const { name } = await api.captureFrame(projectId, clip.start + rel, mediaId);
        onChange([
          ...clip.edits,
          { type: "image", t: rel, d: 3, src: name, query: "", credit: "", y: 0.3, x: null, widthPct: 78, heightPct: 100, style: "card", caption: "", by: "" },
        ]);
        setAt("");
      } catch (e) {
        setError((e as Error).message);
      }
    });
  };

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-3">
        <Label className="text-xs text-muted-foreground">Text</Label>
        {texts.length === 0 ? <p className="text-xs text-muted-foreground">Nothing is written on this clip yet.</p> : null}
        {texts.map(({ edit, index }, position) => (
          <div key={index} className="flex flex-col gap-2 border-s border-border ps-3">
            <div className="flex items-start gap-2">
              <Textarea aria-label={texts.length > 1 ? `Text ${position + 1}` : "Text"}
                rows={2}
                className="flex-1"
                value={edit.text}
                onChange={(e) => setText(index, { text: e.target.value })}
                placeholder="¿Cuántos programadores realmente consiguen trabajo? 💻"
              />
              <Button size="icon-sm" variant="ghost" aria-label={`Remove text ${position + 1}`} title="Remove this text" onClick={() => removeText(index)}><Trash2 /></Button>
            </div>
            <div className="flex gap-2">
              <Select
                value={edit.style}
                onValueChange={(v) => setText(index, { style: v as TextEdit["style"] })}
              >
                <SelectTrigger aria-label={`Text ${position + 1} style`} className="flex-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="card">White card</SelectItem>
                  <SelectItem value="plain">Plain text</SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={edit.y === null ? edit.position : "free"}
                onValueChange={(v) => setText(index, v === "free" ? {} : { position: v as TextEdit["position"], x: null, y: null })}
              >
                <SelectTrigger aria-label={`Text ${position + 1} position`} className="flex-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="top">Top</SelectItem>
                  <SelectItem value="center">Center</SelectItem>
                  <SelectItem value="bottom">Bottom</SelectItem>
                  {/* Only offered once a drag on the frame has written one, and picking any of
                      the three above is the way back from it. */}
                  {edit.y !== null ? <SelectItem value="free">Placed by hand</SelectItem> : null}
                </SelectContent>
              </Select>
            </div>
            <Label className="flex justify-between text-xs text-muted-foreground">
              Shows for <span className="font-mono">{edit.d.toFixed(1)}s</span>
            </Label>
            <Slider aria-label={`Text ${position + 1} duration`} min={1} max={10} step={0.5} value={[edit.d]} onValueChange={(v) => setText(index, { d: num(v) })} />
          </div>
        ))}
        {onAddText ? <Button size="sm" variant="outline" onClick={onAddText}><Plus />Add text</Button> : null}
      </section>

      <section className="flex flex-col gap-3 border-t border-border pt-4">
        <AudioPicker projectId={projectId} clip={clip} atSec={atSec} onChange={onChange} onPlaceBed={onPlaceBed} />
      </section>

      <section className="flex flex-col gap-3 border-t border-border pt-4">
        <Label className="text-xs text-muted-foreground">
          Images from the source video
        </Label>
        <div className="flex gap-2">
          <Input aria-label="Capture time in this clip"
            value={at}
            onChange={(e) => setAt(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addImage()}
            placeholder="When in the clip, e.g. 0:12"
          />
          <Button aria-label="Capture source frame" variant="outline" disabled={!canCapture || pending || !at.trim()} onClick={addImage}>
            {pending ? <Loader2 className="size-4 motion-safe:animate-spin" /> : <ImagePlus className="size-4" />}
          </Button>
        </div>
        {error ? <p className="text-xs text-destructive">{error}</p> : null}

        <ProjectAssets projectId={projectId} onChoose={asset => onChange([...clip.edits, { type: "image", t: atSec(), d: 3, src: asset.id, query: "", credit: asset.attribution ?? "", y: 0.3, x: null, widthPct: 78, heightPct: 100, style: "card", caption: "", by: "" }])} />

        <ImageSearch
          projectId={projectId}
          onAdopt={(asset) =>
            onChange([
              ...clip.edits,
              {
                type: "image",
                t: atSec(),
                d: 3,
                src: asset.id,
                query: "",
                credit: asset.attribution ?? "",
                y: 0.3,
                x: null,
                widthPct: 78,
                heightPct: 100,
                style: "card",
                caption: "",
                by: "",
              },
            ])
          }
        />

        {images.map((im, i) => (
          <div key={`${im.src}-${i}`} className="flex flex-col gap-2 rounded-xl border border-border p-2">
            <div className="flex items-center gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={assetUrl(projectId, im.src)}
                alt=""
                className="h-12 w-20 shrink-0 rounded-lg object-cover"
              />
              <span className="flex-1 font-mono text-xs text-muted-foreground">
                {fmt(im.t)} · {im.d}s
              </span>
              <Button aria-label={`Remove image ${i + 1}`} size="icon" variant="ghost" onClick={() => removeImage(i)}>
                <Trash2 className="size-4" />
              </Button>
            </div>
            <Input aria-label={`Image ${i + 1} caption`}
              value={im.caption}
              onChange={(e) => patchImage(i, { caption: e.target.value })}
              placeholder="Caption (optional)"
              className="h-8"
            />
            <Slider aria-label={`Image ${i + 1} duration`}
              min={1}
              max={10}
              step={0.5}
              value={[im.d]}
              onValueChange={(v) => patchImage(i, { d: num(v) })}
            />
          </div>
        ))}

        {!images.length ? (
          <p className="text-xs text-muted-foreground">
            Pick a moment from the clip and its frame becomes an overlay.
          </p>
        ) : null}
      </section>
    </div>
  );
}
