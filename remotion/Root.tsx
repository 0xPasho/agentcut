import React from "react";
import { emptySequencePlan } from "../src/lib/plan/schema";
import { SequenceComposition } from "./SequenceComposition";
import { sequenceFrames } from "../src/lib/sequences";
import { Composition } from "remotion";
import "./tailwind.css";
import { ClipComposition, type ClipProps } from "./ClipComposition";
import { CARD, CommentCard, commentCardHeight, type CommentCardProps } from "./CommentCard";
import { Clip } from "../src/lib/edl";
import { buildTimeMap, clipFrames } from "../src/lib/timeline";

const PLACEHOLDER: ClipProps = {
  clip: Clip.parse({ id: "preview", title: "Preview", start: 0, end: 10, words: [] }),
  sourceUrl: "",
  sourceWidth: 1920,
  sourceHeight: 1080,
};

export const RemotionRoot: React.FC = () => (
  <>
  <Composition
    id="Clip"
    component={ClipComposition}
    defaultProps={PLACEHOLDER}
    width={1080}
    height={1920}
    fps={30}
    durationInFrames={300}
    calculateMetadata={({ props }) => ({
      durationInFrames: clipFrames(buildTimeMap(props.clip), 30),
    })}
  />
  <Composition id="VideoSequence" component={SequenceComposition}
    defaultProps={{ sequence: { id: "preview", title: "Preview", output: { width: 1920, height: 1080, fps: 30 }, items: [], plan: emptySequencePlan() }, media: [], mediaUrls: {} }}
    width={1920} height={1080} fps={30} durationInFrames={1}
    calculateMetadata={({ props }) => ({ ...props.sequence.output, durationInFrames: sequenceFrames(props.sequence).duration })}
  />
  {/* A viewer's comment, rendered once to a transparent still and placed as a picture. */}
  <Composition id="CommentCard" component={CommentCard}
    defaultProps={{ platform: "tiktok", name: "viewer", text: "¿Qué me recomiendas para empezar?", avatar: "" } as CommentCardProps}
    width={CARD.width} height={400} fps={30} durationInFrames={1}
    calculateMetadata={({ props }) => ({ height: commentCardHeight(props.text) })}
  />
  </>
);
