import { z } from "zod";
import { ProjectPlan, SequencePlan } from "./plan/schema";
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
  /**
   * Shifts the whole caption track against the audio. Positive is later.
   *
   * Word times come from the recogniser and are snapped to the audio, so this is
   * not where sync is meant to be fixed — it is the escape hatch for a source whose
   * own audio and video are offset, which no transcript can correct.
   */
  syncOffsetMs: z.number().min(-1000).max(1000).default(0),
});
export type CaptionStyle = z.infer<typeof CaptionStyle>;

/**
 * Who authored an edit. Empty is a hand-made edit — from the UI, the agent, or
 * the original selection. `template:<id>` marks one a template generated, which
 * is the only reason re-applying a template can replace its own previous output
 * without touching anything a person placed by hand.
 */
export const EditAuthor = z.string().default("");

/**
 * Edits are expressed in CLIP-RELATIVE SOURCE seconds. Silence cuts shift the
 * output timeline, so the renderer builds a source->output time map once and
 * maps everything through it. The agent never has to think about that.
 */
export const SilenceEdit = z.object({
  type: z.literal("silence"),
  t: z.number(),
  d: z.number(),
  by: EditAuthor,
});

export const PunchEdit = z.object({
  type: z.literal("punch"),
  t: z.number(),
  d: z.number().default(1.2),
  scale: z.number().min(1).max(2).default(1.12),
  by: EditAuthor,
});

export const EmphasisEdit = z.object({
  type: z.literal("emphasis"),
  t: z.number(),
  d: z.number().default(1),
  /** Words to highlight, matched case-insensitively within the span. */
  words: z.array(z.string()).default([]),
  color: z.string().default("#ffe600"),
  by: EditAuthor,
});

export const TextEdit = z.object({
  type: z.literal("text"),
  t: z.number(),
  d: z.number().default(2.5),
  text: z.string(),
  position: z.enum(["top", "center", "bottom"]).default("top"),
  /**
   * Free placement, 0..1 of the frame, as the centre of the title block. Dragging the
   * title on the canvas writes these; while `y` is null the `position` preset decides
   * where it sits. `x` alone is ignored — a title without `y` is always centred.
   */
  x: z.number().min(0).max(1).nullable().default(null),
  y: z.number().min(0).max(1).nullable().default(null),
  /** "card" is the white rounded hook that reads on any footage; "plain" is bare text. */
  style: z.enum(["card", "plain"]).default("card"),
  by: EditAuthor,
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
  /**
   * Horizontal centre, 0..1 of width. `null` centres it, which is what a single
   * overlay wants. Two logos side by side — "Google and Facebook" — need two
   * images with different `x`, so this has to be expressible.
   */
  x: z.number().min(0).max(1).nullable().default(null),
  /** Share of frame width. */
  widthPct: z.number().min(5).max(100).default(78),
  /**
   * Ceiling on the share of frame height. A photograph is wider than it is tall and
   * behaves under a width alone; a phone screenshot is the opposite and, in a vertical
   * frame, runs off both ends of it. The picture fits inside both bounds and keeps its
   * own aspect ratio.
   */
  heightPct: z.number().min(5).max(100).default(100),
  /**
   * `card` is the white-bordered photo plate; `plain` is the bare picture, for a
   * cutout or a screenshot that already has its own edges; `logo` is a white
   * rounded plate with padding, which is the only way a monochrome brand mark
   * reads on arbitrary footage.
   */
  style: z.enum(["card", "plain", "logo"]).default("card"),
  caption: z.string().default(""),
  by: EditAuthor,
});

/** A one-shot sound tied to a beat — a whoosh on a punch-in, a ding on a number. */
export const SfxEdit = z.object({
  type: z.literal("sfx"),
  t: z.number(),
  d: z.number().default(2),
  src: z.string(),
  gain: z.number().min(0).max(2).default(0.8),
  by: EditAuthor,
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
  by: EditAuthor,
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
  /** Short labels for what this is — "gameplay", "tutorial". Written by the agent, edited by hand, read by rules. */
  tags: z.array(z.string()).default([]),
});
export type Clip = z.infer<typeof Clip>;

/** Imported source media. Files live in the local project workspace. */
export const MediaSource = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]+$/), name: z.string().min(1), file: z.string().min(1),
  width: z.number().int().positive(), height: z.number().int().positive(),
  fps: z.number().positive(), durationSec: z.number().positive(),
});
export type MediaSource = z.infer<typeof MediaSource>;
/**
 * One shot on a sequence timeline. `mediaId: null` is a canvas segment: the same
 * editable clip properties — duration, captions, titles, images, music — with no
 * source video behind them. Its geometry is bounded by the sequence output frame.
 */
export const ItemTransform = z.object({
  x: z.number(), y: z.number(), width: z.number().positive(), height: z.number().positive(),
  rotation: z.number(), opacity: z.number().min(0).max(1),
});
export type ItemTransform = z.infer<typeof ItemTransform>;
export const DEFAULT_ITEM_TRANSFORM: ItemTransform = { x: 0, y: 0, width: 100, height: 100, rotation: 0, opacity: 1 };
/** Placement uses output seconds and percentages of the output frame. Null/absent at appends on this layer. */
export const ItemPlacement = z.object({
  at: z.number().nonnegative().nullable().optional(), layer: z.number().int().nonnegative().optional(),
  transform: ItemTransform.optional(), volume: z.number().min(0).max(2).optional(),
  muted: z.boolean().optional(), hidden: z.boolean().optional(),
});
/** Named so an agent can ask for one by the word an editor would use. */
export const TransitionKind = z.enum(["dissolve", "dip", "wipe", "slide"]);
export type TransitionKind = z.infer<typeof TransitionKind>;
/** The side the incoming shot arrives from. */
export const TransitionDirection = z.enum(["left", "right", "up", "down"]);

/**
 * How a shot opens against the one before it on its own track.
 *
 * A transition lives on the *incoming* shot because that is the only thing it can
 * belong to without going stale: which two shots meet is already decided by the
 * track, the array order and `at`, and a separate entity holding two item ids would
 * have to be repaired after every move, split and removal. On the item, it travels
 * with the shot for free.
 *
 * `durationSec` is how long the two shots play at once. The overlap is taken out of
 * the programme, not out of the footage: neither shot is trimmed, and neither needs
 * source handles it may not have — a canvas scene has none at all. Removing the
 * transition therefore restores the timing exactly, which consuming handles could not.
 */
export const Transition = z.object({
  kind: TransitionKind.default("dissolve"),
  /** How long the two shots overlap, in output seconds. */
  durationSec: z.number().positive().max(10).default(0.5),
  /** `dip` only: the colour both shots pass through. */
  color: z.string().default("#000000"),
  /** `wipe` and `slide` only: which side the incoming shot arrives from. */
  direction: TransitionDirection.default("left"),
  by: EditAuthor,
});
export type Transition = z.infer<typeof Transition>;
export const SequenceItem = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]+$/), mediaId: z.string().nullable().default(null), clip: Clip,
  /**
   * Absent is a hard cut, which is what every existing project has. Optional rather
   * than defaulted so saving an old timeline does not write `null` into every shot.
   */
  transition: Transition.nullable().optional(),
  ...ItemPlacement.shape,
});
export type SequenceItem = z.infer<typeof SequenceItem>;
export const VideoSequence = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]+$/), title: z.string().min(1),
  output: z.object({ width: z.number().int().positive(), height: z.number().int().positive(), fps: z.number().positive() }),
  items: z.array(SequenceItem).default([]),
  /** What the agent decided for this video and why. See plan/schema.ts. */
  plan: SequencePlan.prefault({}),
});
export type VideoSequence = z.infer<typeof VideoSequence>;

export const Edl = z.object({
  version: z.literal(1).default(1),
  projectId: z.string(),
  /**
   * The primary source video a clipping project was analyzed from. `null` is a
   * project that never had one — a video assembled from imported media, or an
   * empty canvas. Imported media live in `media`, never promoted to this identity.
   */
  source: z.object({
    file: z.string(),
    width: z.number(),
    height: z.number(),
    fps: z.number(),
    durationSec: z.number(),
  }).nullable().default(null),
  output: z.object({
    width: z.number().default(1080),
    height: z.number().default(1920),
    fps: z.number().default(30),
  }).prefault({}),
  clips: z.array(Clip),
  media: z.array(MediaSource).default([]),
  sequences: z.array(VideoSequence).default([]),
  /** What every video in this project shares: brief, template, rules, series. */
  plan: ProjectPlan.prefault({}),
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
  tags: z.array(z.string()).default([]),
  /** Ids of edit-stage rules the agent judged to hold for this clip. Executed by the host after publishing. */
  rules: z.array(z.string()).default([]),
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
