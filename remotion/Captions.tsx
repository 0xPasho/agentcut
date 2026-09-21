import React from "react";
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { CaptionStyle, Edit } from "../src/lib/edl";
import type { Word } from "../src/lib/transcript";
import { activeWordIndex, lineAt, toLines, visibleWords } from "../src/lib/timeline";
import { loadFont } from "@remotion/google-fonts/Inter";

const { fontFamily: inter } = loadFont("normal", {
  weights: ["700", "800"],
  subsets: ["latin"],
});

type Props = {
  words: Word[];
  style: CaptionStyle;
  emphasis: Array<Extract<Edit, { type: "emphasis" }>>;
};

/** Karaoke: the whole line stays readable, the spoken word lights up. */
export const Captions: React.FC<Props> = ({ words, style, emphasis }) => {
  const frame = useCurrentFrame();
  const { fps, height } = useVideoConfig();
  // Frame centre, not frame start: a word beginning mid-frame otherwise lights up
  // a whole frame late, which at 30fps is the 30ms of lag that reads as "off".
  const t = (frame + 0.5) / fps - style.syncOffsetMs / 1000;

  if (style.preset === "none" || !words.length) return null;

  // Line choice and the spoken word live in timeline.ts so the preview, the export
  // and the tests all decide this the same way.
  const line = lineAt(toLines(words, style.maxWordsPerLine), t);
  if (!line) return null;
  const activeIndex = activeWordIndex(line.words, t);
  const shown = visibleWords(line.words, activeIndex, style.preset);
  if (!shown.length) return null;

  const boxed = style.preset === "boxed";
  const popline = style.preset === "popline";

  const fontSize = (style.fontSizePct / 100) * height;
  const emphasized = new Set(
    emphasis
      .filter((e) => t >= e.t - 0.5 && t <= e.t + e.d + 0.5)
      .flatMap((e) => e.words.map((w) => w.toLowerCase().replace(/[^a-z0-9]/g, ""))),
  );

  return (
    <div
      className="absolute inset-x-0 flex justify-center px-[7%]"
      style={{ top: `${style.positionY * 100}%`, fontSize }}
    >
      <div
        data-canvas-captions
        className={
          "flex flex-wrap items-start justify-center gap-x-[0.28em] gap-y-[0.05em] text-center" +
          // The plate is what makes a boxed caption readable, so it carries the
          // padding and the rounding instead of every word carrying an outline.
          (boxed ? " rounded-[0.35em] bg-black/70 px-[0.45em] py-[0.12em]" : "")
        }
      >
        {shown.map((w, i) => {
          const active = popline || line.words.indexOf(w) === activeIndex;
          const key = w.w.toLowerCase().replace(/[^a-z0-9]/g, "");
          const isEmphasis = emphasized.has(key);
          const color = active || isEmphasis ? style.highlight : style.color;
          const label = style.uppercase ? w.w.toUpperCase() : w.w;
          // One word at a time has nothing around it to give it rhythm, so it pops
          // in on its own start. Frame-driven only: CSS transitions depend on render
          // wall time and produce different frames across preview and export workers.
          const scale = popline
            ? interpolate(t - w.t, [0, 0.12], [0.82, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
            : active
              ? 1.08
              : 1;

          return (
            <span
              key={`${i}-${w.t}`}
              className="inline-block leading-[1.15]"
              style={{
                fontFamily: style.fontFamily === "Inter" ? inter : style.fontFamily,
                fontWeight: style.fontWeight,
                fontSize,
                color,
                WebkitTextStroke: boxed ? undefined : `${style.strokeWidth}px #000`,
                paintOrder: "stroke fill",
                transform: `scale(${scale})`,
                textShadow: boxed ? undefined : "0 4px 14px rgba(0,0,0,0.55)",
              }}
            >
              {label}
            </span>
          );
        })}
      </div>
    </div>
  );
};
