import React, { useMemo } from "react";
import {
  AbsoluteFill,
  OffthreadVideo,
  Sequence,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import type { Clip, CropKeyframe, Edit } from "../src/lib/edl";
import { buildTimeMap, mapWords, srcToOut } from "../src/lib/timeline";
import { Captions } from "./Captions";

export type ClipProps = {
  clip: Clip;
  /** Absolute URL to the source video (local file server or Next route). */
  sourceUrl: string;
  sourceWidth: number;
  sourceHeight: number;
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

  const fallbackCrop: CropKeyframe = { t: 0, x: 0, y: 0, w: sourceWidth, h: sourceHeight };
  const crop = cropAt(clip.crop, t, fallbackCrop);

  // Punch-in: ease up over 200ms, hold, ease back down.
  const punchScale = punches.reduce((acc, p) => {
    const start = srcToOut(map, p.t);
    const end = srcToOut(map, p.t + p.d);
    if (t < start || t > end) return acc;
    const eased = interpolate(
      t,
      [start, start + 0.2, Math.max(start + 0.25, end - 0.25), end],
      [1, p.scale, p.scale, 1],
      { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
    );
    return acc * eased;
  }, 1);

  const scale = (width / crop.w) * punchScale;

  return (
    <AbsoluteFill className="overflow-hidden bg-black">
      <AbsoluteFill
        style={{
          transform: `scale(${scale}) translate(${-crop.x - crop.w / 2 + sourceWidth / 2}px, ${
            -crop.y - crop.h / 2 + sourceHeight / 2
          }px)`,
          transformOrigin: "center center",
        }}
      >
        <AbsoluteFill
          style={{
            width: sourceWidth,
            height: sourceHeight,
            left: (width - sourceWidth) / 2,
            top: (height - sourceHeight) / 2,
          }}
        >
          {map.spans.map((span) => {
            const from = Math.round(span.outStart * fps);
            const durationInFrames = Math.max(1, Math.round((span.srcEnd - span.srcStart) * fps));
            return (
              <Sequence key={span.srcStart} from={from} durationInFrames={durationInFrames}>
                <OffthreadVideo
                  src={sourceUrl}
                  trimBefore={Math.round((clip.start + span.srcStart) * fps)}
                  trimAfter={Math.round((clip.start + span.srcEnd) * fps)}
                  className="h-full w-full object-cover"
                />
              </Sequence>
            );
          })}
        </AbsoluteFill>
      </AbsoluteFill>

      {texts.map((tx, i) => {
        const start = srcToOut(map, tx.t);
        const end = srcToOut(map, tx.t + tx.d);
        if (t < start || t > end) return null;
        const place =
          tx.position === "top" ? "top-[12%]" : tx.position === "center" ? "top-1/2" : "bottom-[16%]";
        return (
          <div key={i} className={`absolute inset-x-0 ${place} flex justify-center px-[8%]`}>
            <span className="rounded-2xl bg-black/70 px-8 py-4 text-center text-6xl font-black leading-tight text-white">
              {tx.text}
            </span>
          </div>
        );
      })}

      <Captions words={words} style={clip.captions} emphasis={emphasis} />
    </AbsoluteFill>
  );
};
