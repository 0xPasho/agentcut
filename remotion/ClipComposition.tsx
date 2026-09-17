import React, { useMemo } from "react";
import { AbsoluteFill, Audio, Img, Sequence, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { Clip, CropKeyframe, Edit, Region } from "../src/lib/edl";
import { buildTimeMap, mapWords, srcToOut } from "../src/lib/timeline";
import { duckedVolume, speechSpans } from "../src/lib/ducking";
import { Captions } from "./Captions";
import { VideoRegion } from "./VideoRegion";

export type ClipProps = {
  clip: Clip;
  /** Absolute URL to the source video (local file server or Next route). */
  sourceUrl: string;
  sourceWidth: number;
  sourceHeight: number;
  /** Base URL for a project-local file name. */
  assetBase?: string;
  /**
   * Explicit URL per asset reference. A reference is either a library asset id or
   * a file in the project's assets/, and the two resolve differently on the
   * server and in the browser — so whoever mounts the composition resolves them.
   */
  assetUrls?: Record<string, string>;
  /**
   * Compose the clip's edits without source video. Sequence canvas layers also set
   * transparent so their titles, images, and audio can overlap footage below.
   */
  hideVideo?: boolean;
  transparent?: boolean;
  hideVisuals?: boolean;
  volume?: number;
  muted?: boolean;
};

/** Linear interpolation between crop keyframes, in source pixel space. */
function cropAt(keys: CropKeyframe[], t: number, fallback: CropKeyframe): CropKeyframe {
  if (!keys.length) return fallback;
  if (keys.length === 1 || t <= keys[0].t) return keys[0];
  const last = keys[keys.length - 1];
  if (t >= last.t) return last;
  const i = keys.findIndex((k, n) => n < keys.length - 1 && t >= k.t && t < keys[n + 1].t);
  const a = keys[Math.max(0, i)];
  const b = keys[Math.max(0, i) + 1] ?? a;
  const p = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t);
  return {
    t,
    x: a.x + (b.x - a.x) * p,
    y: a.y + (b.y - a.y) * p,
    w: a.w + (b.w - a.w) * p,
    h: a.h + (b.h - a.h) * p,
  };
}

export const ClipComposition: React.FC<ClipProps> = ({
  clip,
  sourceUrl,
  sourceWidth,
  sourceHeight,
  assetBase = "",
  assetUrls = {},
  hideVideo = false,
  transparent = false,
  hideVisuals = false,
  volume = 1,
  muted = false,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const t = frame / fps;

  const map = useMemo(() => buildTimeMap(clip), [clip]);
  const words = useMemo(() => mapWords(map, clip.words), [map, clip.words]);

  const punches = clip.edits.filter((e): e is Extract<Edit, { type: "punch" }> => e.type === "punch");
  const emphasis = clip.edits.filter(
    (e): e is Extract<Edit, { type: "emphasis" }> => e.type === "emphasis",
  );
  const texts = clip.edits.filter((e): e is Extract<Edit, { type: "text" }> => e.type === "text");
  const images = clip.edits.filter((e): e is Extract<Edit, { type: "image" }> => e.type === "image");
  const sfx = clip.edits.filter((e): e is Extract<Edit, { type: "sfx" }> => e.type === "sfx");
  const music = clip.edits.filter((e): e is Extract<Edit, { type: "music" }> => e.type === "music");

  // Words are already mapped to output time, which is the timebase the ducking
  // envelope is sampled in.
  const spans = useMemo(() => speechSpans(words), [words]);
  const urlFor = (ref: string) => assetUrls[ref] ?? `${assetBase}${ref}`;

  // Punch-in: ease up over 200ms, hold, ease back down.
  const zoom = punches.reduce((acc, p) => {
    const start = srcToOut(map, p.t);
    const end = srcToOut(map, p.t + p.d);
    if (t < start || t > end) return acc;
    return (
      acc *
      interpolate(
        t,
        [start, start + 0.2, Math.max(start + 0.25, end - 0.25), end],
        [1, p.scale, p.scale, 1],
        { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
      )
    );
  }, 1);

  const shared = { sourceUrl, sourceWidth, sourceHeight, clipStart: clip.start, map, zoom, volume, muted };

  let video: React.ReactNode = null;
  if (hideVideo) {
    video = null;
  } else if (clip.layout.type === "split") {
    const topHeight = Math.round((height * clip.layout.topPct) / 100);
    video = (
      <div className="flex h-full w-full flex-col">
        <VideoRegion {...shared} region={clip.layout.top} boxWidth={width} boxHeight={topHeight} />
        <VideoRegion
          {...shared}
          muted
          region={clip.layout.bottom}
          boxWidth={width}
          boxHeight={height - topHeight}
        />
      </div>
    );
  } else {
    const fallback: CropKeyframe = { t: 0, x: 0, y: 0, w: sourceWidth, h: sourceHeight };
    const crop = cropAt(clip.crop, t, fallback);
    const region: Region = { x: crop.x, y: crop.y, w: crop.w, h: crop.h };
    video = <VideoRegion {...shared} region={region} boxWidth={width} boxHeight={height} />;
  }

  return (
    <AbsoluteFill className="overflow-hidden" style={{ backgroundColor: transparent ? "transparent" : "black" }}>
      <AbsoluteFill style={{ visibility: hideVisuals ? "hidden" : "visible" }}>{video}</AbsoluteFill>

      {music.map((m, i) => {
        const from = Math.round(srcToOut(map, m.t) * fps);
        const until = Math.round(srcToOut(map, m.t + m.d) * fps);
        return (
          <Sequence key={`music-${i}`} from={from} durationInFrames={Math.max(1, until - from)} layout="none">
            <Audio
              src={urlFor(m.src)}
              loop={m.loop}
              muted={muted}
              volume={(f) => volume * (m.duck ? duckedVolume(spans, (from + f) / fps, m.gain) : m.gain)}
            />
          </Sequence>
        );
      })}

      {sfx.map((s, i) => {
        const from = Math.round(srcToOut(map, s.t) * fps);
        return (
          <Sequence
            key={`sfx-${i}`}
            from={from}
            durationInFrames={Math.max(1, Math.round(s.d * fps))}
            layout="none"
          >
            <Audio src={urlFor(s.src)} muted={muted} volume={volume * s.gain} />
          </Sequence>
        );
      })}

      <AbsoluteFill style={{ visibility: hideVisuals ? "hidden" : "visible" }}>
      {images.map((im, i) => {
        const start = srcToOut(map, im.t);
        const end = srcToOut(map, im.t + im.d);
        if (t < start || t > end) return null;
        // Ease in and out so it lands rather than blinks.
        const appear = interpolate(
          t,
          [start, start + 0.25, Math.max(start + 0.3, end - 0.25), end],
          [0, 1, 1, 0],
          { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
        );
        // Centring lives in the inline transform. Tailwind v4's -translate-y-1/2 sets
        // the separate `translate` property, which composes with it and would lift the
        // picture a further half-height off the mark `y` asks for.
        return (
          <div
            key={`img-${i}`}
            className="absolute inset-x-0 flex flex-col items-center gap-3"
            style={{ top: `${im.y * 100}%`, opacity: appear, transform: `translateY(-50%) scale(${0.96 + appear * 0.04})` }}
          >
            {/* Remotion's Img holds the frame until the picture has decoded; a plain
                <img> exports as an empty box. A reference that cannot be fetched is
                skipped rather than failing the whole export. */}
            <Img
              src={urlFor(im.src)}
              alt=""
              onError={() => console.warn(`Image asset could not be loaded: ${im.src}`)}
              className="rounded-[28px] border-[6px] border-white object-contain shadow-[0_24px_60px_-12px_rgba(0,0,0,0.75)]"
              style={{ width: `${im.widthPct}%` }}
            />
            {im.caption ? (
              <span className="rounded-full bg-white px-6 py-2 text-3xl font-black text-black">
                {im.caption}
              </span>
            ) : null}
          </div>
        );
      })}

      {texts.map((tx, i) => {
        const start = srcToOut(map, tx.t);
        const end = srcToOut(map, tx.t + tx.d);
        if (t < start || t > end) return null;
        const place =
          tx.position === "top" ? "top-[9%]" : tx.position === "center" ? "top-[45%]" : "bottom-[18%]";
        // The white card reads on any footage; plain text needs the stroke to survive.
        const card =
          tx.style === "card"
            ? "rounded-[40px] bg-white px-10 py-6 text-black shadow-[0_20px_50px_-12px_rgba(0,0,0,0.6)]"
            : "text-white [text-shadow:0_4px_18px_rgba(0,0,0,0.75)]";
        return (
          <div key={`tx-${i}`} className={`absolute inset-x-0 ${place} flex justify-center px-[7%]`}>
            <span data-canvas-title className={`text-center text-[64px] font-black leading-[1.12] tracking-tight ${card}`}>
              {tx.text}
            </span>
          </div>
        );
      })}

      <Captions words={words} style={clip.captions} emphasis={emphasis} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
