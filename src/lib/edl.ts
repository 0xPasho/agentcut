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

export const CaptionStyle = z.object({
  preset: z.enum(["karaoke", "popline", "boxed", "none"]).default("karaoke"),
  fontFamily: z.string().default("Inter"),
  fontWeight: z.number().default(800),
  fontSizePct: z.number().min(1).max(30).default(7), // % of output height
  color: z.string().default("#ffffff"),
  highlight: z.string().default("#ffe600"),
  strokeWidth: z.number().default(8),
  // 0 = top, 1 = bottom of frame
  positionY: z.number().min(0).max(1).default(0.78),
  maxWordsPerLine: z.number().min(1).max(12).default(4),
  uppercase: z.boolean().default(false),
});
export type CaptionStyle = z.infer<typeof CaptionStyle>;

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
  captions: CaptionStyle.prefault({}),
  words: z.array(Word).default([]),
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
  captions: CaptionStyle.partial().optional(),
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
