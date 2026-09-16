import React, { useMemo } from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { Clip, CropKeyframe, Edit, Region } from "../src/lib/edl";
import { buildTimeMap, mapWords, srcToOut } from "../src/lib/timeline";
import { Captions } from "./Captions";
import { VideoRegion } from "./VideoRegion";

export type ClipProps = {
  clip: Clip;
  /** Absolute URL to the source video (local file server or Next route). */
  sourceUrl: string;
  sourceWidth: number;
  sourceHeight: number;
  /** Base URL for image edits; `src` values resolve against it. */
  assetBase?: string;
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

  const shared = { sourceUrl, sourceWidth, sourceHeight, clipStart: clip.start, map, zoom };

  let video: React.ReactNode;
  if (clip.layout.type === "split") {
    const topHeight = Math.round((height * clip.layout.topPct) / 100);
    video = (
      <div className="flex h-full w-full flex-col">
        <VideoRegion {...shared} region={clip.layout.top} boxWidth={width} boxHeight={topHeight} />
        <VideoRegion
          {...shared}
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
    <AbsoluteFill className="overflow-hidden bg-black">
      {video}

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
        return (
          <div
            key={`img-${i}`}
            className="absolute inset-x-0 flex -translate-y-1/2 flex-col items-center gap-3"
            style={{ top: `${im.y * 100}%`, opacity: appear, transform: `translateY(-50%) scale(${0.96 + appear * 0.04})` }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`${assetBase}${im.src}`}
              alt=""
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
            <span className={`text-center text-[64px] font-black leading-[1.12] tracking-tight ${card}`}>
              {tx.text}
            </span>
          </div>
        );
      })}

      <Captions words={words} style={clip.captions} emphasis={emphasis} />
    </AbsoluteFill>
  );
};
