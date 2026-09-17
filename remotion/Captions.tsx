import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import type { CaptionStyle, Edit } from "../src/lib/edl";
import type { Word } from "../src/lib/transcript";
import { toLines } from "../src/lib/timeline";
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
  const t = frame / fps;

  if (style.preset === "none" || !words.length) return null;

  const lines = toLines(words, style.maxWordsPerLine);
  const line = lines.find((l) => t >= l.start - 0.15 && t <= l.end + 0.25);
  if (!line) return null;

  const fontSize = (style.fontSizePct / 100) * height;
  const emphasized = new Set(
    emphasis
      .filter((e) => t >= e.t - 0.5 && t <= e.t + e.d + 0.5)
      .flatMap((e) => e.words.map((w) => w.toLowerCase().replace(/[^a-z0-9]/g, ""))),
  );

  return (
    <div
      className="absolute inset-x-0 flex flex-wrap items-start justify-center gap-x-[0.28em] gap-y-[0.05em] px-[7%] text-center"
      style={{ top: `${style.positionY * 100}%`, fontSize }}
    >
      {line.words.map((w, i) => {
        const active = t >= w.t && t <= w.t + w.d;
        const key = w.w.toLowerCase().replace(/[^a-z0-9]/g, "");
        const isEmphasis = emphasized.has(key);
        const color = active || isEmphasis ? style.highlight : style.color;
        const label = style.uppercase ? w.w.toUpperCase() : w.w;

        return (
          <span
            key={`${i}-${w.t}`}
            className="inline-block leading-[1.15] transition-transform"
            style={{
              fontFamily: style.fontFamily === "Inter" ? inter : style.fontFamily,
              fontWeight: style.fontWeight,
              fontSize,
              color,
              WebkitTextStroke: `${style.strokeWidth}px #000`,
              paintOrder: "stroke fill",
              transform: `scale(${active ? 1.08 : 1})`,
              textShadow: "0 4px 14px rgba(0,0,0,0.55)",
            }}
          >
            {label}
          </span>
        );
      })}
    </div>
  );
};
