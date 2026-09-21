"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { Loader2, Music, Play, Search, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api, assetUrl, type AssetSummary } from "@/lib/client";
import type { Clip, Edit } from "@/lib/edl";

type SfxEdit = Extract<Edit, { type: "sfx" }>;
type MusicEdit = Extract<Edit, { type: "music" }>;
/** One hit from `assets.searchAudio`. Adopted into the project before it can be placed. */
type AudioHit = { provider: string; id: string; title: string; durationSec: number; license: string };

const num = (v: number | readonly number[]) => (Array.isArray(v) ? v[0] : (v as number));
const soundName = (name: string) => name.replace(/\.[a-z0-9]+$/i, "");

/** Listen before placing. One element for the whole panel: two sounds at once tell you nothing. */
function useAudition() {
  const [playing, setPlaying] = useState<HTMLAudioElement | null>(null);
  useEffect(() => () => playing?.pause(), [playing]);
  return (url: string) => {
    playing?.pause();
    const element = new Audio(url);
    setPlaying(element);
    void element.play().catch(() => {});
  };
}

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
}: {
  projectId: string;
  clip: Clip;
  /** Where a new sound effect lands, clip-relative. Read when it is added. */
  atSec: () => number;
  onChange: (edits: Edit[]) => void;
}) {
  const [sounds, setSounds] = useState<AssetSummary[]>([]);
  const audition = useAudition();

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
        <Select value={music?.src ?? "none"} onValueChange={(v) => setMusic(!v || v === "none" ? null : { src: v })}>
          <SelectTrigger aria-label="Music bed">
            <SelectValue placeholder="No music" />
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
              Ducking drops the bed while words are sounding, using the word timestamps. Without it
              the music fights the voice.
            </p>
          </>
        ) : null}
        <SoundSearch projectId={projectId} kind="music" onAdopted={asset => adopted(asset, id => setMusic({ src: id }))} />
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
