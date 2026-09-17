import React from "react";
import { AbsoluteFill, Sequence } from "remotion";
import { DEFAULT_ITEM_TRANSFORM, type MediaSource, type VideoSequence } from "../src/lib/edl";
import { sequenceFrames } from "../src/lib/sequences";
import { ClipComposition } from "./ClipComposition";
export type SequenceProps = { sequence: VideoSequence; media: MediaSource[]; mediaUrls: Record<string, string>; assetBase?: string; assetUrls?: Record<string, string> };
export const SequenceComposition: React.FC<SequenceProps> = ({ sequence, media, mediaUrls, assetBase, assetUrls }) => <AbsoluteFill style={{ backgroundColor: "black" }}>
  {sequenceFrames(sequence).items.toSorted((a, b) => (a.item.layer ?? 0) - (b.item.layer ?? 0)).map(({ item, from, duration }) => {
    const source = item.mediaId === null ? null : media.find(m => m.id === item.mediaId);
    // A canvas segment is deliberately source-free. A shot whose media has gone missing
    // is a broken project, and silently exporting it as a black canvas would hide that.
    if (item.mediaId !== null && !source) throw new Error(`Shot “${item.clip.title}” references missing media ${item.mediaId}`);
    const transform = { ...DEFAULT_ITEM_TRANSFORM, ...item.transform };
    return <Sequence key={item.id} from={from} durationInFrames={duration}>
      <div data-canvas-item={item.id} style={{ position: "absolute", left: `${transform.x}%`, top: `${transform.y}%`,
        width: `${transform.width}%`, height: `${transform.height}%`,
        transform: transform.rotation ? `rotate(${transform.rotation}deg)` : undefined, opacity: transform.opacity,
      }}>
        <div style={{ position: "relative", width: sequence.output.width, height: sequence.output.height,
          transformOrigin: "0 0", transform: transform.width === 100 && transform.height === 100 ? undefined : `scale(${transform.width / 100}, ${transform.height / 100})`,
        }}>
          <ClipComposition clip={item.clip} hideVideo={!source} transparent hideVisuals={item.hidden}
            volume={item.volume} muted={item.muted}
            sourceUrl={source ? mediaUrls[source.id] ?? "" : ""}
            sourceWidth={source?.width ?? sequence.output.width} sourceHeight={source?.height ?? sequence.output.height}
            assetBase={assetBase} assetUrls={assetUrls} />
        </div>
      </div>
    </Sequence>;
  })}
</AbsoluteFill>;
