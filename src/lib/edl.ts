import { z } from "zod";
import { Word } from "./transcript";

/** Crop window in SOURCE pixel space, sampled at time `t`. Renderer interpolates between keyframes. */
export const CropKeyframe = z.object({
  t: z.number(),
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
});
export type CropKeyframe = z.infer<typeof CropKeyframe>;

/** A rectangle in SOURCE pixel space. */
export const Region = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
});
export type Region = z.infer<typeof Region>;

/**
 * Screen-share streams break a single crop: the centre of the frame is usually
 * wallpaper, and the speaker sits in a small corner. Split stacks the two regions
 * that actually matter — face on top, the content being shown underneath.
 */
export const SplitLayout = z.object({
  type: z.literal("split"),
  top: Region,
  bottom: Region,
  /** Share of output height given to the top region. */
  topPct: z.number().min(15).max(85).default(40),
});

export const CropLayout = z.object({ type: z.literal("crop") });

export const Layout = z.discriminatedUnion("type", [CropLayout, SplitLayout]);
export type Layout = z.infer<typeof Layout>;

export const CaptionStyle = z.object({
  preset: z.enum(["karaoke", "popline", "boxed", "none"]).default("karaoke"),
  fontFamily: z.string().default("Inter"),
  fontWeight: z.number().default(800),
  fontSizePct: z.number().min(1).max(30).default(5.5), // % of output height
  color: z.string().default("#ffffff"),
  highlight: z.string().default("#ffe600"),
  strokeWidth: z.number().default(8),
  /**
   * Top edge of the caption block, 0 = top of frame. Anchored at the top rather
   * than the centre so a block that wraps to two or three rows grows downward
   * instead of straddling a split-layout seam.
   */
  positionY: z.number().min(0).max(1).default(0.72),
  maxWordsPerLine: z.number().min(1).max(12).default(3),
  uppercase: z.boolean().default(false),
});
export type CaptionStyle = z.infer<typeof CaptionStyle>;

/**
 * Edits are expressed in CLIP-RELATIVE SOURCE seconds. Silence cuts shift the
 * output timeline, so the renderer builds a source->output time map once and
 * maps everything through it. The agent never has to think about that.
 */
export const SilenceEdit = z.object({
  type: z.literal("silence"),
  t: z.number(),
  d: z.number(),
});

export const PunchEdit = z.object({
  type: z.literal("punch"),
  t: z.number(),
  d: z.number().default(1.2),
  scale: z.number().min(1).max(2).default(1.12),
});

export const EmphasisEdit = z.object({
  type: z.literal("emphasis"),
  t: z.number(),
  d: z.number().default(1),
  /** Words to highlight, matched case-insensitively within the span. */
  words: z.array(z.string()).default([]),
  color: z.string().default("#ffe600"),
});

export const TextEdit = z.object({
  type: z.literal("text"),
  t: z.number(),
  d: z.number().default(2.5),
  text: z.string(),
  position: z.enum(["top", "center", "bottom"]).default("top"),
  /** "card" is the white rounded hook that reads on any footage; "plain" is bare text. */
  style: z.enum(["card", "plain"]).default("card"),
});

/**
 * An image alongside the captions.
 *
 * `src` is an asset id. Older EDLs hold a bare filename in the project's assets/
 * folder and still resolve. `query` is what the agent writes instead: it has no
 * network access, so it describes what to show and the resolver finds it.
 */
export const ImageEdit = z.object({
  type: z.literal("image"),
  t: z.number(),
  d: z.number().default(3),
  src: z.string().default(""),
  query: z.string().default(""),
  credit: z.string().default(""),
  /** Where it sits in the frame, 0..1 of height. */
  y: z.number().min(0).max(1).default(0.3),
  /** Share of frame width. */
  widthPct: z.number().min(20).max(100).default(78),
  caption: z.string().default(""),
});

/** A one-shot sound tied to a beat — a whoosh on a punch-in, a ding on a number. */
export const SfxEdit = z.object({
  type: z.literal("sfx"),
  t: z.number(),
  d: z.number().default(2),
  src: z.string(),
  gain: z.number().min(0).max(2).default(0.8),
});

/**
 * A music bed. `duck` lowers it while words are sounding — computed from the
 * word timestamps we already have, so no audio analysis is involved. Music
 * without ducking is the single clearest tell of an amateur edit.
 */
export const MusicEdit = z.object({
  type: z.literal("music"),
  t: z.number().default(0),
  d: z.number().default(60),
  src: z.string(),
  gain: z.number().min(0).max(2).default(0.28),
  duck: z.boolean().default(true),
  loop: z.boolean().default(true),
});

export const Edit = z.discriminatedUnion("type", [
  SilenceEdit,
  PunchEdit,
  EmphasisEdit,
  TextEdit,
  ImageEdit,
  SfxEdit,
  MusicEdit,
]);
export type Edit = z.infer<typeof Edit>;

export const Clip = z.object({
  id: z.string(),
  title: z.string(),
  /** Why the agent picked it. Shown in the UI; makes bad picks debuggable. */
  reason: z.string().default(""),
  hook: z.string().default(""),
  score: z.number().min(0).max(100).default(50),
  start: z.number(),
  end: z.number(),
  crop: z.array(CropKeyframe).default([]),
  layout: Layout.default({ type: "crop" }),
  captions: CaptionStyle.prefault({}),
  words: z.array(Word).default([]),
  edits: z.array(Edit).default([]),
});
export type Clip = z.infer<typeof Clip>;

export const Edl = z.object({
  version: z.literal(1).default(1),
  projectId: z.string(),
  source: z.object({
    file: z.string(),
    width: z.number(),
    height: z.number(),
    fps: z.number(),
    durationSec: z.number(),
  }),
  output: z.object({
    width: z.number().default(1080),
    height: z.number().default(1920),
    fps: z.number().default(30),
  }).prefault({}),
  clips: z.array(Clip),
});
export type Edl = z.infer<typeof Edl>;

/** What the agent is asked to produce. Everything else is filled in deterministically. */
export const AgentClipProposal = z.object({
  title: z.string(),
  hook: z.string().default(""),
  reason: z.string().default(""),
  score: z.number().min(0).max(100),
  start: z.number(),
  end: z.number(),
  crop: z.array(CropKeyframe).default([]),
  layout: Layout.optional(),
  captions: CaptionStyle.partial().optional(),
  edits: z.array(Edit).default([]),
});
export const AgentClipProposals = z.object({ clips: z.array(AgentClipProposal) });
export type AgentClipProposal = z.infer<typeof AgentClipProposal>;

/** Center crop to the target aspect — the fallback when the agent gives no keyframes. */
export function centerCrop(srcW: number, srcH: number, outW: number, outH: number): CropKeyframe {
  const targetAR = outW / outH;
  let w = srcH * targetAR;
  let h = srcH;
  if (w > srcW) {
    w = srcW;
    h = srcW / targetAR;
  }
  return { t: 0, x: Math.round((srcW - w) / 2), y: Math.round((srcH - h) / 2), w: Math.round(w), h: Math.round(h) };
}
