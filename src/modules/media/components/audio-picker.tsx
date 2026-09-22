"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { Loader2, Music, Play, Search, Volume2 } from "lucide-react";
import { Button } from "@/common/ui/button";
import { Input } from "@/common/ui/input";
import { Label } from "@/common/ui/label";
import { Slider } from "@/common/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/common/ui/select";
import { api, assetUrl, type AssetSummary } from "@/common/api/client";
import type { Clip, Edit } from "@/modules/editor/types";
import { type SfxEdit, type MusicEdit, type AudioHit } from "../types";
import { num, soundName } from "../lib";
import { useAudition } from "../hooks";

/**
 * Finding a sound online, through the same `assets.searchAudio` / `assets.adoptAudio`
 * services the agent calls. A hit is downloaded into the project and registered with its
 * licence before it is placed, so what lands on the timeline is an ordinary asset.
 */
function SoundSearch({ projectId, kind, onAdopted }: {
  projectId: string;
  kind: "sfx" | "music";
  onAdopted: (asset: AssetSummary) => void;
}) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<AudioHit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const audition = useAudition();

  const search = () => {
    const text = query.trim();
    if (!text) return;
    start(async () => {
      setError(null);
      try {
        const found = await api.editorTool<AudioHit[]>(projectId, { tool: "assets.searchAudio", query: text, kind });
        setHits(found);
        if (!found.length) setError("Nothing free-licence matched that. Try plainer words.");
      } catch (e) { setError((e as Error).message); setHits(null); }
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <Input
          value={query}
          disabled={busy}
          placeholder={kind === "music" ? "calm piano loop" : "whoosh, ding, impact"}
          aria-label={kind === "music" ? "Search for music" : "Search for a sound effect"}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); search(); } }}
        />
        <Button type="button" variant="outline" size="sm" disabled={busy || !query.trim()} onClick={search}>
          {busy ? <Loader2 className="motion-safe:animate-spin" /> : <Search />}Find
        </Button>
      </div>
      {error ? <p role="alert" className="text-[11px] text-muted-foreground">{error}</p> : null}
      {hits?.length ? (
        <ul className="flex max-h-56 flex-col gap-1 overflow-y-auto">
          {hits.map(hit => (
            <li key={`${hit.provider}-${hit.id}`} className="flex items-center gap-2 rounded-md border border-border px-2 py-1">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs">{hit.title}</span>
                <span className="block truncate text-[10px] text-muted-foreground">
                  {hit.durationSec ? `${hit.durationSec.toFixed(1)}s · ` : ""}{hit.license}
                </span>
              </span>
              <Button
                type="button" size="xs" variant="outline" disabled={busy}
                onClick={() => start(async () => {
                  setError(null);
                  try {
                    const asset = await api.editorTool<AssetSummary>(projectId, { tool: "assets.adoptAudio", query: query.trim(), kind, provider: hit.provider, id: hit.id });
                    audition(assetUrl(projectId, asset.id));
                    onAdopted(asset);
                  } catch (e) { setError((e as Error).message); }
                })}
              >Use</Button>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="text-[10px] text-muted-foreground">Openverse, free-licence only. Credits are kept with the asset.</p>
    </div>
  );
}

export function AudioPicker({
  projectId,
  clip,
  atSec,
  onChange,
  onPlaceBed,
}: {
  projectId: string;
  clip: Clip;
  /** Where a new sound effect lands, clip-relative. Read when it is added. */
  atSec: () => number;
  onChange: (edits: Edit[]) => void;
  /**
   * A bed is not something a shot carries: it plays across the cuts, so choosing one here
   * puts it on the audio track under the picture. Beds already written into a shot — by an
   * older edit or a template — stay editable in place, because the fix for those is to move
   * them, not to hide their level and their ducking.
   */
  onPlaceBed?: (assetId: string) => void;
}) {
  const [sounds, setSounds] = useState<AssetSummary[]>([]);
  const audition = useAudition();

  const loadSounds = () => api.editorTool<AssetSummary[]>(projectId, { tool: "assets.list", kind: "audio" }).then(setSounds);
  useEffect(() => { void loadSounds().catch(() => setSounds([])); }, [projectId]);

  const music = clip.edits.find((e): e is MusicEdit => e.type === "music");
  const sfx = clip.edits.filter((e): e is SfxEdit => e.type === "sfx");
  /** The bed is not in this scene, it *is* this scene: a canvas item on the audio track. */
  const ownScene = !!music && clip.edits.length === 1 && music.t === 0 && Math.abs(music.d - (clip.end - clip.start)) < 0.01;

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
      by: music?.by ?? "",
      ...music,
      ...patch,
    };
    if (!next.src) onChange(rest);
    else if (musicIndex < 0) onChange([...clip.edits, next]);
    else onChange(clip.edits.map((edit, index) => index === musicIndex ? next : edit));
  };

  const addSfx = (assetId: string) => onChange([...clip.edits, { type: "sfx", t: atSec(), d: 2, src: assetId, gain: 0.8, by: "" }]);
  /** A sound that was just downloaded is in the list and in use in one gesture. */
  const adopted = (asset: AssetSummary, use: (id: string) => void) => {
    setSounds(current => current.some(s => s.id === asset.id) ? current : [asset, ...current]);
    use(asset.id);
  };

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-3">
        <Label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Music className="size-3.5" /> Music bed
        </Label>
        <Select value={music?.src ?? "none"} onValueChange={(v) => {
          if (!v || v === "none") return setMusic(null);
          if (!music && onPlaceBed) return onPlaceBed(v);
          setMusic({ src: v });
        }}>
          <SelectTrigger aria-label="Music bed">
            {/* The value is an asset id. Left to say itself it says "a_3a24748a8f46", which
                is not the name of a piece of music. */}
            <SelectValue placeholder="No music">{(value: string) => value === "none" || !value ? "No music" : soundName(sounds.find(s => s.id === value)?.name ?? value)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No music</SelectItem>
            {sounds.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {soundName(s.name)}
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
              Ducking drops the bed while words are sounding, using the word timings. Without it
              the music fights the voice.
            </p>
          </>
        ) : null}
        <p className="text-[11px] text-muted-foreground">{!music
          ? "A bed goes on the audio track under the picture, so it plays across every cut."
          : ownScene
            ? "This bed is a track of its own, so it plays across every cut. Trim it on the timeline to change how long it runs."
            : "This bed is written into this shot, so it stops when the shot does. Drag it onto the audio track to let it play across the cuts."}</p>
        <SoundSearch projectId={projectId} kind="music" onAdopted={asset => adopted(asset, id => { if (!music && onPlaceBed) onPlaceBed(id); else setMusic({ src: id }); })} />
      </section>

      <section className="flex flex-col gap-3 border-t border-border pt-4">
        <Label className="text-xs text-muted-foreground">Sound effect at playhead</Label>
        <div className="flex flex-wrap gap-2">
          {sounds.map((s) => (
            <span key={s.id} className="inline-flex overflow-hidden rounded-md border border-border">
              <button
                type="button"
                aria-label={`Preview ${soundName(s.name)}`}
                title={`Preview ${soundName(s.name)}`}
                className="px-1.5 text-muted-foreground hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                onClick={() => audition(assetUrl(projectId, s.id))}
              ><Play className="size-3" /></button>
              <button
                type="button"
                aria-label={`Add sound effect ${soundName(s.name)}`}
                title={soundName(s.name)}
                className="border-l border-border px-2 py-1 text-xs hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                onClick={() => addSfx(s.id)}
              >{soundName(s.name).slice(0, 18)}</button>
            </span>
          ))}
          {!sounds.length ? (
            <p className="text-xs text-muted-foreground">
              No sounds yet — search below, or add your own in the <Link href="/library" className="underline underline-offset-4">library</Link>.
            </p>
          ) : null}
        </div>
        <SoundSearch projectId={projectId} kind="sfx" onAdopted={asset => adopted(asset, addSfx)} />
        {sfx.length ? (
          <p className="text-[11px] text-muted-foreground">{sfx.length} in this clip</p>
        ) : null}
      </section>
    </div>
  );
}
