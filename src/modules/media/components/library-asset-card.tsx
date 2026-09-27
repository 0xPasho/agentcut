"use client";

import { useRef, useState } from "react";
import { ArrowUpRight, Expand, Film, ImageIcon, Music, Pause, Play, Volume2, VolumeX } from "lucide-react";
import { Button, buttonVariants } from "../../../common/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "../../../common/ui/dialog";
import { Slider } from "../../../common/ui/slider";
import { assetFileUrl, type AssetSummary } from "../../../common/api/client";
import { seconds } from "../../settings/lib";
import { useLibraryPlayback } from "../hooks";
import { DeleteLibraryAsset } from "./delete-library-asset";

export function LibraryAssetCard({ asset, origin, onRemove }: { asset: AssetSummary; origin: string; onRemove: (id: string) => Promise<void> }) {
  const title = useRef<HTMLHeadingElement>(null);
  return (
    <li className="min-w-0">
      <Dialog>
        <DialogTrigger render={<button type="button" />} aria-label={`Preview ${asset.name}`}
          className="group flex w-full min-w-0 cursor-pointer flex-col overflow-hidden rounded-3xl bg-card text-start ring-1 ring-foreground/10 transition-[box-shadow,background-color] duration-150 hover:bg-secondary hover:ring-foreground/25 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring motion-reduce:transition-none">
          <span className="relative block aspect-video w-full overflow-hidden bg-black/30">
            <LibraryThumbnail asset={asset} />
            <span className="absolute end-3 bottom-3 flex items-center gap-1.5 rounded-full bg-black/80 px-2.5 py-1.5 text-xs text-white">
              <Expand aria-hidden className="size-3.5" />Preview
            </span>
          </span>
          <span className="flex w-full min-w-0 flex-col gap-2 px-4 py-3.5">
            <span className="line-clamp-2 min-h-10 text-sm font-medium leading-5 wrap-anywhere" title={asset.name}>{asset.name}</span>
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              {asset.kind === "image" && <ImageIcon aria-hidden className="size-3.5" />}
              {asset.kind === "video" && <Film aria-hidden className="size-3.5" />}
              {asset.kind === "audio" && <Music aria-hidden className="size-3.5" />}
              <span className="tabular-nums">{asset.width && asset.height ? `${asset.width} × ${asset.height}` : origin}</span>
              {!!asset.duration_sec && <span className="tabular-nums">· {seconds(asset.duration_sec)}</span>}
            </span>
          </span>
        </DialogTrigger>
        <DialogContent initialFocus={title} className="sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle ref={title} tabIndex={-1} className="wrap-anywhere">{asset.name}</DialogTitle>
            <DialogDescription>{origin} · Available in every project</DialogDescription>
          </DialogHeader>
          <LibraryPreview asset={asset} />
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
            <div><dt className="text-xs text-muted-foreground">Type</dt><dd className="mt-1 capitalize">{asset.kind}</dd></div>
            {!!asset.width && !!asset.height && <div><dt className="text-xs text-muted-foreground">Dimensions</dt><dd className="mt-1 tabular-nums">{asset.width} × {asset.height}</dd></div>}
            {!!asset.duration_sec && <div><dt className="text-xs text-muted-foreground">Duration</dt><dd className="mt-1 tabular-nums">{seconds(asset.duration_sec)}</dd></div>}
            {asset.license && <div><dt className="text-xs text-muted-foreground">License</dt><dd className="mt-1 wrap-anywhere">{asset.license}</dd></div>}
            {asset.attribution && <div className="col-span-2"><dt className="text-xs text-muted-foreground">Attribution</dt><dd className="mt-1 wrap-anywhere">{asset.attribution}</dd></div>}
          </dl>
          <DialogFooter className="sm:items-center sm:justify-between">
            <p className="max-w-sm text-xs text-muted-foreground">Add this file to a video from Library in the editor’s media panel.</p>
            <div className="flex items-center gap-2">
              <DeleteLibraryAsset asset={asset} onRemove={onRemove} />
              <a href={assetFileUrl(asset.id)} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "outline", size: "sm" })}>
                <ArrowUpRight aria-hidden className="size-4" />Open original<span className="sr-only"> in a new tab</span>
              </a>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </li>
  );
}

function LibraryThumbnail({ asset }: { asset: AssetSummary }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <span className="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground"><ImageIcon aria-hidden className="size-5" />Preview unavailable</span>;
  if (asset.kind === "image") return <img src={assetFileUrl(asset.id)} alt="" loading="lazy" onError={() => setFailed(true)} className="size-full object-contain outline-1 -outline-offset-1 outline-white/10" />;
  if (asset.kind === "video") return <video src={assetFileUrl(asset.id)} muted playsInline preload="metadata" aria-hidden tabIndex={-1} onError={() => setFailed(true)} className="pointer-events-none size-full object-contain outline-1 -outline-offset-1 outline-white/10" />;
  return <span className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground"><Music aria-hidden className="size-9" /><span className="text-xs">Audio</span></span>;
}

function LibraryPreview({ asset }: { asset: AssetSummary }) {
  const playback = useLibraryPlayback();
  const { media, playing, position, duration, muted, error } = playback;
  const events = {
    onPlay: () => playback.setPlaying(true),
    onPause: () => playback.setPlaying(false),
    onEnded: () => playback.setPlaying(false),
    onTimeUpdate: () => playback.setPosition(media.current?.currentTime ?? 0),
    onLoadedMetadata: () => { const length = media.current?.duration ?? 0; playback.setDuration(Number.isFinite(length) ? length : 0); },
    onError: () => playback.setError("Preview unavailable. Try opening the original file."),
  };
  return (
    <div className="overflow-hidden rounded-xl bg-black/40 ring-1 ring-white/10">
      {error && <p role="alert" className="p-5 text-sm text-muted-foreground">{error}</p>}
      {!error && asset.kind === "image" && <img src={assetFileUrl(asset.id)} alt={asset.name} onError={events.onError} className="max-h-[55dvh] min-h-32 w-full object-contain" />}
      {asset.kind === "video" && <video ref={(element) => { media.current = element; }} src={assetFileUrl(asset.id)} playsInline preload="metadata" aria-label={`Video preview of ${asset.name}`} className="max-h-[50dvh] w-full object-contain" {...events} />}
      {asset.kind === "audio" && <div className="flex min-h-40 items-center justify-center"><Music aria-hidden className="size-12 text-muted-foreground" /><audio ref={(element) => { media.current = element; }} src={assetFileUrl(asset.id)} preload="metadata" {...events} /></div>}
      {asset.kind !== "image" && <div className="flex flex-wrap items-center gap-3 border-t border-white/10 p-3">
        <Button variant="outline" size="icon-lg" aria-label={playing ? "Pause preview" : "Play preview"} onClick={() => void playback.toggle()}>{playing ? <Pause aria-hidden /> : <Play aria-hidden />}</Button>
        <div className="min-w-20 flex-1"><Slider aria-label="Preview position" aria-valuetext={`${seconds(position)} of ${seconds(duration)}`} min={0} max={duration || 1} step={0.1} value={position} disabled={!duration} onValueChange={playback.seek} /></div>
        <span className="text-xs text-muted-foreground tabular-nums">{seconds(position)} / {seconds(duration)}</span>
        <Button variant="ghost" size="icon-lg" aria-label={muted ? "Unmute preview" : "Mute preview"} aria-pressed={muted} onClick={playback.toggleMute}>{muted ? <VolumeX aria-hidden /> : <Volume2 aria-hidden />}</Button>
      </div>}
    </div>
  );
}
