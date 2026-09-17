"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Music, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api, type AssetSummary } from "@/lib/client";
import type { Clip, Edit } from "@/lib/edl";

type SfxEdit = Extract<Edit, { type: "sfx" }>;
type MusicEdit = Extract<Edit, { type: "music" }>;

const num = (v: number | readonly number[]) => (Array.isArray(v) ? v[0] : (v as number));

export function AudioPicker({
  projectId,
  clip,
  atSec,
  onChange,
}: {
  projectId: string;
  clip: Clip;
  /** Where a new sound effect lands, clip-relative. */
  atSec: number;
  onChange: (edits: Edit[]) => void;
}) {
  const [sounds, setSounds] = useState<AssetSummary[]>([]);

  const loadSounds = () => api.editorTool<AssetSummary[]>(projectId, { tool: "assets.list", kind: "audio" }).then(setSounds);
  useEffect(() => { void loadSounds().catch(() => setSounds([])); }, [projectId]);

  const music = clip.edits.find((e): e is MusicEdit => e.type === "music");
  const sfx = clip.edits.filter((e): e is SfxEdit => e.type === "sfx");

  const setMusic = (patch: Partial<MusicEdit> | null) => {
    const musicIndex = clip.edits.findIndex(e => e.type === "music");
    const rest = clip.edits.filter((_, index) => index !== musicIndex);
    if (!patch) return onChange(rest);
    const next: MusicEdit = {
      type: "music",
      t: 0,
      // A bed covers the whole clip unless told otherwise.
      d: clip.end - clip.start,
      src: music?.src ?? "",
      gain: music?.gain ?? 0.28,
      duck: music?.duck ?? true,
      loop: music?.loop ?? true,
      ...music,
      ...patch,
    };
    if (!next.src) onChange(rest);
    else if (musicIndex < 0) onChange([...clip.edits, next]);
    else onChange(clip.edits.map((edit, index) => index === musicIndex ? next : edit));
  };

  if (!sounds.length) {
    return (
      <p className="text-xs text-muted-foreground">
        No sounds yet. <Button size="xs" variant="outline" onClick={() => void loadSounds().catch(() => setSounds([]))}>Refresh sounds</Button>{" "}
        <Link href="/library" className="underline underline-offset-4">
          Add some to the library
        </Link>{" "}
        or drop files into <code className="font-mono">workspace/library/audio/</code>.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <Button variant="outline" size="xs" onClick={() => void loadSounds().catch(() => setSounds([]))}>Refresh sounds</Button>
      <section className="flex flex-col gap-3">
        <Label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Music className="size-3.5" /> Music bed
        </Label>
        <Select value={music?.src ?? "none"} onValueChange={(v) => setMusic(!v || v === "none" ? null : { src: v })}>
          <SelectTrigger aria-label="Music bed">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No music</SelectItem>
            {sounds.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {music ? (
          <>
            <Label className="flex justify-between text-xs text-muted-foreground">
              Level <span className="font-mono">{Math.round(music.gain * 100)}%</span>
            </Label>
            <Slider aria-label="Music volume"
              min={0}
              max={2}
              step={0.01}
              value={[music.gain]}
              onValueChange={(v) => setMusic({ gain: num(v) })}
            />
            <Button
              size="sm"
              variant={music.duck ? "default" : "outline"}
              onClick={() => setMusic({ duck: !music.duck })}
            >
              <Volume2 className="size-3.5" />
              {music.duck ? "Ducking under speech" : "Ducking off"}
            </Button>
            <p className="text-[11px] text-muted-foreground">
              Ducking drops the bed while words are sounding, using the word timestamps. Without it
              the music fights the voice.
            </p>
          </>
        ) : null}
      </section>

      <section className="flex flex-col gap-3 border-t border-border pt-4">
        <Label className="text-xs text-muted-foreground">Sound effect at playhead</Label>
        <div className="flex flex-wrap gap-2">
          {sounds.map((s) => (
            <Button
              key={s.id}
              aria-label={`Add sound effect ${s.name}`}
              title={s.name}
              size="xs"
              variant="outline"
              onClick={() =>
                onChange([...clip.edits, { type: "sfx", t: atSec, d: 2, src: s.id, gain: 0.8 }])
              }
            >
              {s.name.replace(/\.[a-z0-9]+$/i, "").slice(0, 18)}
            </Button>
          ))}
        </div>
        {sfx.length ? (
          <p className="text-[11px] text-muted-foreground">{sfx.length} in this clip</p>
        ) : null}
      </section>
    </div>
  );
}
