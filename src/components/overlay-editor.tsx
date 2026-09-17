"use client";

import { useState, useTransition } from "react";
import { ImagePlus, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api, assetUrl } from "@/lib/client";
import { ImageSearch } from "@/components/image-search";
import { AudioPicker } from "@/components/audio-picker";
import { fmt } from "@/lib/transcript";
import type { Clip, Edit } from "@/lib/edl";

type TextEdit = Extract<Edit, { type: "text" }>;
type ImageEdit = Extract<Edit, { type: "image" }>;

const num = (v: number | readonly number[]) => (Array.isArray(v) ? v[0] : (v as number));

export function OverlayEditor({
  projectId,
  clip,
  atSec = 0,
  onChange,
}: {
  projectId: string;
  clip: Clip;
  /** Where new overlays land, clip-relative. The editor passes its playhead. */
  atSec?: number;
  onChange: (edits: Edit[]) => void;
}) {
  const [at, setAt] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const hook = clip.edits.find((e): e is TextEdit => e.type === "text");
  const images = clip.edits.filter((e): e is ImageEdit => e.type === "image");
  const others = clip.edits.filter((e) => e.type !== "text");

  const setHook = (patch: Partial<TextEdit>) => {
    const next: TextEdit = {
      type: "text",
      t: hook?.t ?? 0,
      d: hook?.d ?? 2.5,
      text: hook?.text ?? "",
      position: hook?.position ?? "top",
      style: hook?.style ?? "card",
      ...patch,
    };
    onChange(next.text.trim() ? [next, ...others] : others);
  };

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
    const rel = parseTime(at);
    if (rel === null) return setError("Use seconds or m:ss");
    setError(null);
    start(async () => {
      try {
        const { name } = await api.captureFrame(projectId, clip.start + rel);
        onChange([
          ...clip.edits,
          { type: "image", t: rel, d: 3, src: name, query: "", credit: "", y: 0.3, widthPct: 78, caption: "" },
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
        <Label className="text-xs text-muted-foreground">Hook title</Label>
        <Textarea
          rows={2}
          value={hook?.text ?? ""}
          onChange={(e) => setHook({ text: e.target.value })}
          placeholder="¿Cuántos programadores realmente consiguen trabajo? 💻"
        />
        <div className="flex gap-2">
          <Select
            value={hook?.style ?? "card"}
            onValueChange={(v) => setHook({ style: v as TextEdit["style"] })}
          >
            <SelectTrigger className="flex-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="card">White card</SelectItem>
              <SelectItem value="plain">Plain text</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={hook?.position ?? "top"}
            onValueChange={(v) => setHook({ position: v as TextEdit["position"] })}
          >
            <SelectTrigger className="flex-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="top">Top</SelectItem>
              <SelectItem value="center">Center</SelectItem>
              <SelectItem value="bottom">Bottom</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {hook ? (
          <div className="flex flex-col gap-2">
            <Label className="flex justify-between text-xs text-muted-foreground">
              Shows for <span className="font-mono">{hook.d.toFixed(1)}s</span>
            </Label>
            <Slider min={1} max={10} step={0.5} value={[hook.d]} onValueChange={(v) => setHook({ d: num(v) })} />
          </div>
        ) : null}
      </section>

      <section className="flex flex-col gap-3 border-t border-border pt-4">
        <AudioPicker projectId={projectId} clip={clip} atSec={atSec} onChange={onChange} />
      </section>

      <section className="flex flex-col gap-3 border-t border-border pt-4">
        <Label className="text-xs text-muted-foreground">
          Images — grabbed from the stream itself
        </Label>
        <div className="flex gap-2">
          <Input
            value={at}
            onChange={(e) => setAt(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addImage()}
            placeholder="When in the clip, e.g. 0:12"
          />
          <Button variant="outline" disabled={pending || !at.trim()} onClick={addImage}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />}
          </Button>
        </div>
        {error ? <p className="text-xs text-destructive">{error}</p> : null}

        <ImageSearch
          projectId={projectId}
          onAdopt={(asset) =>
            onChange([
              ...clip.edits,
              {
                type: "image",
                t: atSec,
                d: 3,
                src: asset.id,
                query: "",
                credit: asset.attribution ?? "",
                y: 0.3,
                widthPct: 78,
                caption: "",
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
              <Button size="icon" variant="ghost" onClick={() => removeImage(i)}>
                <Trash2 className="size-4" />
              </Button>
            </div>
            <Input
              value={im.caption}
              onChange={(e) => patchImage(i, { caption: e.target.value })}
              placeholder="Caption (optional)"
              className="h-8"
            />
            <Slider
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

/** Accepts "12", "12.5" or "1:05". */
function parseTime(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  if (s.includes(":")) {
    const [m, sec] = s.split(":");
    const v = Number(m) * 60 + Number(sec);
    return Number.isFinite(v) ? v : null;
  }
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
}
