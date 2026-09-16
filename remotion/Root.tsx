import React from "react";
import { Composition } from "remotion";
import "./tailwind.css";
import { ClipComposition, type ClipProps } from "./ClipComposition";
import { Clip } from "../src/lib/edl";
import { buildTimeMap } from "../src/lib/timeline";

const PLACEHOLDER: ClipProps = {
  clip: Clip.parse({ id: "preview", title: "Preview", start: 0, end: 10, words: [] }),
  sourceUrl: "",
  sourceWidth: 1920,
  sourceHeight: 1080,
};

export const RemotionRoot: React.FC = () => (
  <Composition
    id="Clip"
    component={ClipComposition}
    defaultProps={PLACEHOLDER}
    width={1080}
    height={1920}
    fps={30}
    durationInFrames={300}
    calculateMetadata={({ props }) => ({
      durationInFrames: Math.max(1, Math.round(buildTimeMap(props.clip).duration * 30)),
    })}
  />
);
