import React, { useMemo } from "react";
import { AbsoluteFill, Audio, Easing, Img, Sequence, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { Clip, CropKeyframe, Edit, Region } from "../src/lib/edl";
import { buildTimeMap, mapCrop, mapWindow, mapWords, srcToOut } from "../src/lib/timeline";
import { duckedVolume, speechSpans } from "../src/lib/ducking";
import { crossfadeGain, type AudioFade } from "../src/lib/sequences";
import { Captions } from "./Captions";
import { emWidth, fitScale } from "../src/lib/text-fit";
import { VideoRegion } from "./VideoRegion";

/** Seconds a punch-in takes to reach full scale, and to come back. */
const PUNCH_RAMP_SEC = 0.3;

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
  /**
   * The item's own gain: a number, or its gain at one of its own frames when keyframes
   * animate it. A function here composes with a transition's crossfade rather than
   * replacing it — a bed that ducks under a line still ramps across the joint it sits on.
   */
  volume?: number | ((itemFrame: number) => number);
  muted?: boolean;
  /**
   * Ramps at either end of the shot, in its own frames, when a transition overlaps it.
   * Absent is no ramp at all, which is what a timeline of hard cuts renders.
   */
  fade?: AudioFade;
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

/**
 * A hook card is one word wider than its card when somebody says a URL, and the letters
 * at the ends are then cut off by the frame. The card is drawn smaller rather than drawn
 * outside the picture, on the same estimate the captions use.
 */
const TITLE_PX = 64;
const CARD_PADDING_PX = 80;
const titleFit = (text: string, width: number, carded: boolean) => {
  const longest = text.split(/\s+/).reduce((a, b) => (emWidth(b) > emWidth(a) ? b : a), "");
  return fitScale(longest, (width * 0.86 - (carded ? CARD_PADDING_PX : 0)) / TITLE_PX);
};

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
  fade,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const t = frame / fps;

  const map = useMemo(() => buildTimeMap(clip), [clip]);
  const words = useMemo(() => mapWords(map, clip.words), [map, clip.words]);

  const punches = clip.edits.filter((e): e is Extract<Edit, { type: "punch" }> => e.type === "punch");
  // Captions are drawn on the output clock, so the spans that colour their words
  // have to arrive on it too — an emphasis is written in source seconds like every
  // other edit, and a clip with cuts in it coloured the wrong line.
  const emphasis = clip.edits
    .filter((e): e is Extract<Edit, { type: "emphasis" }> => e.type === "emphasis")
    .map((e) => ({ ...e, ...mapWindow(map, e.t, e.d) }));
  const texts = clip.edits.filter((e): e is Extract<Edit, { type: "text" }> => e.type === "text");
  const images = clip.edits.filter((e): e is Extract<Edit, { type: "image" }> => e.type === "image");
  const sfx = clip.edits.filter((e): e is Extract<Edit, { type: "sfx" }> => e.type === "sfx");
  const music = clip.edits.filter((e): e is Extract<Edit, { type: "music" }> => e.type === "music");
  /** The shot's own length in source seconds, the clock every edit's `t` and `d` are written on. */
  const clipSec = clip.end - clip.start;

  // Words are already mapped to output time, which is the timebase the ducking
  // envelope is sampled in.
  const spans = useMemo(() => speechSpans(words), [words]);
  /** This shot's gain at one of its own frames, once its keyframes and a crossfade are in it. */
  const animated = typeof volume === "function";
  const level = (f: number) => (animated ? (volume as (itemFrame: number) => number)(f) : (volume as number));
  const gainAt = (f: number) => (fade ? level(f) * crossfadeGain(f, fade) : level(f));
  // Nothing animated and no joint means the gain is still a plain number all the way down,
  // so a project without keyframes hands Remotion exactly the props it always did.
  const perFrame = animated || !!fade;
  const urlFor = (ref: string) => assetUrls[ref] ?? `${assetBase}${ref}`;

  // Punch-in: ease up over ~300ms, hold, ease back down. Both ramps use an
  // ease-in-out curve; a linear ramp starts and stops dead and reads as a jump
  // rather than a zoom.
  //
  // A punch is written in source seconds and played in output seconds, so a cut
  // underneath it makes it shorter than it was written — and a punch of six tenths of
  // a second in the script can reach the screen as half of one. At exactly twice the
  // ramp the two middle moments are the same moment, which is a range that does not
  // strictly increase, and Remotion refuses it: the export died on a real stream at
  // frame 419 for that reason. A punch that short has no hold. It peaks and comes back.
  const zoom = punches.reduce((acc, p) => {
    const start = srcToOut(map, p.t);
    const end = srcToOut(map, p.t + p.d);
    // A punch entirely inside a cut has no moment left to play in.
    if (end <= start || t < start || t > end) return acc;
    const ramp = Math.min(PUNCH_RAMP_SEC, (end - start) / 2);
    const held = end - start > ramp * 2;
    return (
      acc *
      interpolate(
        t,
        held ? [start, start + ramp, end - ramp, end] : [start, (start + end) / 2, end],
        held ? [1, p.scale, p.scale, 1] : [1, p.scale, 1],
        { easing: Easing.inOut(Easing.quad), extrapolateLeft: "clamp", extrapolateRight: "clamp" },
      )
    );
  }, 1);

  const shared = { sourceUrl, sourceWidth, sourceHeight, clipStart: clip.start, map, zoom, volume: perFrame ? gainAt : (volume as number), muted };

  let video: React.ReactNode = null;
  if (hideVideo) {
    video = null;
  } else if (clip.layout.type === "split") {
    const topHeight = Math.round((height * clip.layout.topPct) / 100);
    // The punch is a move on the speaker. Zooming the screen pane too makes the shared
    // content lurch on every beat, so only the half holding the camera is pushed in —
    // whichever half that is. Both panes are the same file, so only one carries sound.
    const cameraOnTop = clip.layout.camera !== "bottom";
    video = (
      <div className="flex h-full w-full flex-col">
        <VideoRegion
          {...shared}
          zoom={cameraOnTop ? zoom : 1}
          region={clip.layout.top}
          boxWidth={width}
          boxHeight={topHeight}
        />
        <VideoRegion
          {...shared}
          muted
          zoom={cameraOnTop ? 1 : zoom}
          region={clip.layout.bottom}
          boxWidth={width}
          boxHeight={height - topHeight}
        />
      </div>
    );
  } else {
    const fallback: CropKeyframe = { t: 0, x: 0, y: 0, w: sourceWidth, h: sourceHeight };
    const crop = cropAt(mapCrop(map, clip.crop), t, fallback);
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
              volume={(f) => gainAt(from + f) * (m.duck ? duckedVolume(spans, (from + f) / fps, m.gain) : m.gain)}
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
            <Audio src={urlFor(s.src)} muted={muted} volume={perFrame ? (f) => gainAt(from + f) * s.gain : (volume as number) * s.gain} />
          </Sequence>
        );
      })}

      <AbsoluteFill style={{ visibility: hideVisuals ? "hidden" : "visible" }}>
      {images.map((im, i) => {
        const start = srcToOut(map, im.t);
        const end = srcToOut(map, im.t + im.d);
        if (t < start || t > end) return null;
        // A picture that lands inside a shot eases in and out so it arrives rather than blinks.
        // A picture that fills its shot IS the shot: the cut in and out of it is its entrance,
        // and easing that leaves its first and last frames empty — a blink in the export, and
        // in the editor the very frame the playhead parks on when the picture is added, where
        // an author sees the selection box around nothing at all.
        const fills = im.t <= 0.001 && im.d >= clipSec - 0.001;
        const appear = fills ? 1 : interpolate(
          t,
          [start, start + 0.25, Math.max(start + 0.3, end - 0.25), end],
          [0, 1, 1, 0],
          { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
        );
        // Centring lives in the inline transform. Tailwind v4's -translate-y-1/2 sets
        // the separate `translate` property, which composes with it and would lift the
        // picture a further half-height off the mark `y` asks for.
        // A centred overlay spans the frame and centres inside it. An overlay with an
        // explicit `x` is only as wide as it asks for, so two of them can sit side by side.
        const placed = im.x !== null;
        // Exact pixels rather than percentages: a percentage max-height against an
        // auto-height absolute wrapper resolves to "none", which is precisely the case
        // that lets a tall screenshot run off the top of the frame.
        const boxWidth = (im.widthPct / 100) * width;
        const boxHeight = (im.heightPct / 100) * height;
        /* Remotion's Img holds the frame until the picture has decoded; a plain
           <img> exports as an empty box. A reference that cannot be fetched is
           skipped rather than failing the whole export. */
        const picture = (
          <Img
            src={urlFor(im.src)}
            alt=""
            onError={() => console.warn(`Image asset could not be loaded: ${im.src}`)}
            className={
              im.style === "card"
                ? "rounded-[28px] border-[6px] border-white object-contain shadow-[0_24px_60px_-12px_rgba(0,0,0,0.75)]"
                : im.style === "logo"
                  ? "w-full object-contain"
                  : "object-contain"
            }
            style={im.style === "logo" ? undefined : { maxWidth: boxWidth, maxHeight: boxHeight, width: "auto", height: "auto" }}
          />
        );
        return (
          <div
            key={`img-${i}`}
            data-canvas-image={im.src}
            className={`absolute flex flex-col items-center ${placed ? "" : "inset-x-0"}`}
            style={{
              top: `${im.y * 100}%`,
              ...(placed ? { left: `${im.x! * 100}%`, width: `${im.widthPct}%` } : {}),
              opacity: appear,
              transform: `translate(${placed ? "-50%" : "0"}, -50%) scale(${0.96 + appear * 0.04})`,
            }}
          >
          {/* The inner box is what the canvas handles measure: the picture and its caption,
              not the full-width row that centres them. */}
          <div data-canvas-edit={clip.edits.indexOf(im)} className="flex flex-col items-center gap-3">
            {im.style === "logo" ? (
              // A monochrome brand mark disappears into dark footage without a plate.
              <div
                className="flex aspect-square items-center justify-center rounded-[18%] bg-white p-[12%] shadow-[0_24px_60px_-12px_rgba(0,0,0,0.75)]"
                style={{ width: Math.min(boxWidth, boxHeight) }}
              >
                {picture}
              </div>
            ) : (
              picture
            )}
            {im.caption ? (
              <span className="rounded-full bg-white px-6 py-2 text-3xl font-black text-black">
                {im.caption}
              </span>
            ) : null}
          </div>
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
        // A dragged title carries its own centre. The row keeps the preset's 86% width so the
        // text wraps exactly as it did before it was moved; only where it sits changes.
        const free = tx.y !== null;
        const freeStyle: React.CSSProperties | undefined = free
          ? tx.x !== null
            ? { left: `${tx.x * 100}%`, top: `${tx.y! * 100}%`, width: "86%", transform: "translate(-50%, -50%)" }
            : { top: `${tx.y! * 100}%`, transform: "translateY(-50%)" }
          : undefined;
        return (
          <div key={`tx-${i}`} className={`absolute ${free ? (tx.x !== null ? "" : "inset-x-0") : `inset-x-0 ${place}`} flex justify-center ${free && tx.x !== null ? "" : "px-[7%]"}`} style={freeStyle}>
            <span data-canvas-title data-canvas-edit={clip.edits.indexOf(tx)}
              className={`text-center font-black leading-[1.12] tracking-tight [overflow-wrap:anywhere] ${card}`}
              style={{ fontSize: TITLE_PX * titleFit(tx.text, width, tx.style === "card") }}>
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
