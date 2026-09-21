import { z } from "zod";
import { ClipPatch } from "../editor/operations";

/**
 * A template is *structure*, not content: where the hook sits, how the captions
 * read, how often a picture is allowed to interrupt, what the rhythm is. It is
 * plain data so that a person can write one in a text editor, an agent can emit
 * one, and both get the identical result through the shared operation engine.
 */

/** A caption patch, so a template can restyle captions without restating every field. */
export const TemplateCaptions = ClipPatch.shape.captions;

export const TemplateSlot = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]+$/),
  label: z.string().min(1),
  /**
   * `imagePool` is an ordered set of pictures consumed one at a time — a folder of
   * chat screenshots is the case this exists for. The others are a single asset or
   * a line of text the template interpolates.
   */
  kind: z.enum(["imagePool", "image", "audio", "text"]),
  description: z.string().default(""),
  required: z.boolean().default(false),
});
export type TemplateSlot = z.infer<typeof TemplateSlot>;

export const TemplateHook = z.object({
  /** `sticky` holds for the whole video, `intro` only for `seconds`. */
  mode: z.enum(["off", "sticky", "intro"]).default("sticky"),
  /** Empty means "use the clip's own hook, then its title". */
  text: z.string().default(""),
  seconds: z.number().positive().nullable().default(null),
  position: z.enum(["top", "center", "bottom"]).default("top"),
  style: z.enum(["card", "plain"]).default("card"),
  maxWords: z.number().int().min(1).max(24).default(9),
  uppercase: z.boolean().default(false),
});
export type TemplateHook = z.infer<typeof TemplateHook>;

/**
 * Where a picture may come from, in preference order. Resolution stops at the
 * first source that answers, so putting `brand` before `web` is what makes
 * "Google" become the Google mark instead of a photograph of an office.
 *
 * - `slot` / `slot:<id>` — the next unused picture from a filled `imagePool` slot
 * - `brand` — the official mark, when the subject is a brand name
 * - `project` — an image already in this project or the library, matched by name
 * - `frame` — a still captured from the shot's own footage at that moment
 * - `web` / `web:<provider>` — image search, optionally restricted to one provider
 */
export const TemplateImageSource = z.string().regex(/^(slot|brand|project|frame|web)(:[a-zA-Z0-9_-]+)?$/);

export const TemplateImages = z.object({
  /**
   * `auto` is the one that matches how a good short actually looks: a picture
   * lands on the sentences that name something, and the sentences in between are
   * left alone. `every` illustrates all of them, `alternate` forces every other
   * one regardless of what it says, `off` disables pictures entirely.
   */
  mode: z.enum(["off", "every", "alternate", "auto"]).default("auto"),
  /** Ceiling on the share of sentences that may get a picture. */
  density: z.number().min(0).max(1).default(0.45),
  /** Minimum output seconds between two pictures. */
  minGapSec: z.number().min(0).default(2.5),
  /** Minimum number of sentences skipped between two pictures. 1 = never two in a row. */
  minSentenceGap: z.number().int().min(0).max(10).default(1),
  durationSec: z.number().positive().default(2.6),
  /** Start slightly before the sentence so the picture is already there on the word. */
  leadSec: z.number().min(0).max(2).default(0.15),
  maxCount: z.number().int().min(0).max(200).default(24),
  /** How strongly a sentence must name something before it earns a picture. */
  minSalience: z.number().min(0).max(1).default(0.45),
  y: z.number().min(0).max(1).default(0.3),
  x: z.number().min(0).max(1).nullable().default(null),
  widthPct: z.number().min(5).max(100).default(78),
  /**
   * Ceiling on the share of frame height an overlay may take. The default leaves room
   * for a hook above and captions below, which is what a vertical frame actually has.
   */
  heightPct: z.number().min(5).max(100).default(52),
  /** `auto` uses the logo plate for a brand mark and the photo card for anything else. */
  style: z.enum(["auto", "card", "plain", "logo"]).default("auto"),
  /**
   * A brand mark needs far less of the frame than a photograph: it is a symbol, not a
   * picture, and at photo width its white plate swamps the shot and collides with a
   * sticky hook. Used whenever an overlay resolves to the logo plate.
   */
  logoWidthPct: z.number().min(5).max(100).default(42),
  /** Print the subject under the picture. */
  caption: z.enum(["none", "subject"]).default("none"),
  sources: z.array(TemplateImageSource).default(["slot", "brand", "project", "web"]),
  /** Pair two logos on one beat when a sentence names two brands ("Google and Facebook"). */
  pairBrands: z.boolean().default(true),
});
export type TemplateImages = z.infer<typeof TemplateImages>;

/**
 * Where a sound comes from, in the same shape everywhere a template asks for one:
 * an `audio` slot the author filled, a literal asset id, or a search that is run and
 * adopted into the project the way a picture is. Empty means the template stays silent
 * there rather than picking something at random.
 */
export const TemplateSoundSource = z.object({
  enabled: z.boolean().default(false),
  slot: z.string().default(""),
  assetId: z.string().default(""),
  /**
   * One of the sounds that ship with the app, by name: whoosh, ding, pop, impact, riser,
   * click, swipe, sparkle. An asset id cannot be written into a built-in template — ids are
   * generated per machine — and this is how a template arrives with its sound design already
   * working, offline. A starter sound the owner deleted is simply not played.
   */
  starter: z.string().default(""),
  /** Free-licence audio search, e.g. "whoosh transition". Only used when nothing above answers. */
  query: z.string().default(""),
});
export type TemplateSoundSource = z.infer<typeof TemplateSoundSource>;

export const TemplateRhythm = z.object({
  silence: z.object({
    enabled: z.boolean().default(true),
    /** Gaps shorter than this are speech rhythm, not dead air. */
    minGapSec: z.number().min(0.1).default(0.45),
    /** Left behind so the cut does not sound clipped. */
    keepSec: z.number().min(0).default(0.12),
    /** A gap longer than this is a scene change, not a pause; leave it alone. */
    maxGapSec: z.number().min(0.5).default(4),
  }).prefault({}),
  /**
   * A phrase said twice in a row — the false start every stream is full of: "y entonces
   * yo… y entonces yo creo que". Natural to say, wrong to publish, and invisible to the
   * dead-air pass because there is no silence in it. The stumble goes, the complete run stays.
   */
  redundancy: z.object({
    enabled: z.boolean().default(true),
    /** How long the restart may take. Past this, saying it again is deliberate. */
    maxGapSec: z.number().min(0).default(1.5),
    /** The shortest repeated run worth cutting. One word is emphasis ("muy, muy"); two is a stumble. */
    minWords: z.number().int().min(1).max(8).default(2),
    /** Left before the second run so the join does not sound clipped. */
    keepSec: z.number().min(0).default(0.08),
  }).prefault({}),
  punch: z.object({
    enabled: z.boolean().default(true),
    perMinute: z.number().min(0).max(30).default(4),
    scale: z.number().min(1).max(2).default(1.12),
    durationSec: z.number().positive().default(1.2),
    /** A sound on every punch-in — a whoosh, a hit — from an `audio` slot, an asset or a search. */
    sfx: TemplateSoundSource.extend({
      gain: z.number().min(0).max(2).default(0.6),
      durationSec: z.number().positive().default(0.8),
    }).prefault({}),
  }).prefault({}),
  emphasis: z.object({
    enabled: z.boolean().default(true),
    color: z.string().default("#ffe600"),
    targets: z.array(z.enum(["numbers", "brands", "entities"])).default(["numbers", "brands"]),
  }).prefault({}),
});
export type TemplateRhythm = z.infer<typeof TemplateRhythm>;

export const TemplateMusic = TemplateSoundSource.extend({
  gain: z.number().min(0).max(2).default(0.22),
  duck: z.boolean().default(true),
  loop: z.boolean().default(true),
});

/**
 * The sounds a template places that are not tied to a punch-in: a sting on every cut
 * between shots, and one on the opening frame.
 *
 * `mode: "off"` silences everything the template would add — its bed, its punch sounds
 * and these — in one field, so a sound design is something a video can refuse whole
 * rather than something that has to be unpicked edit by edit.
 */
export const TemplateSound = z.object({
  mode: z.enum(["on", "off"]).default("on"),
  transitions: TemplateSoundSource.extend({
    gain: z.number().min(0).max(2).default(0.5),
    durationSec: z.number().positive().default(0.7),
  }).prefault({}),
  opener: TemplateSoundSource.extend({
    gain: z.number().min(0).max(2).default(0.7),
    durationSec: z.number().positive().default(1.2),
  }).prefault({}),
});
export type TemplateSound = z.infer<typeof TemplateSound>;

/**
 * A mark held in a corner for the whole video — a channel logo, a show bug. It is
 * placed as an ordinary image on its own layer, so it can be moved or removed by
 * hand afterwards like anything else a template writes.
 */
export const TemplateWatermark = z.object({
  enabled: z.boolean().default(false),
  /** An `image` slot id to take the picture from, or a literal asset id. */
  slot: z.string().default(""),
  assetId: z.string().default(""),
  /**
   * Bottom by default, because a sticky hook sits at the top: two things the same
   * template placed should not fight for the same corner. A template whose hook is
   * elsewhere can take a top corner back.
   */
  corner: z.enum(["top-left", "top-right", "bottom-left", "bottom-right"]).default("bottom-right"),
  /** Share of the output width. */
  widthPct: z.number().min(2).max(40).default(12),
  opacity: z.number().min(0.05).max(1).default(0.9),
  /** Distance from both edges, as a share of the output frame. */
  marginPct: z.number().min(0).max(20).default(4),
});
export type TemplateWatermark = z.infer<typeof TemplateWatermark>;

/**
 * A title card pinned to a position in the finished video. This is how a template
 * imposes a shape — an opening promise, a turn in the middle, a closing ask —
 * without knowing anything about the words.
 */
/**
 * A brand kit: colours, fonts and a mark. Captions take the palette and font unless
 * the template sets its own; the watermark takes the logo unless it has one. A
 * glossary subject can carry a kit too, so a project about that subject inherits it.
 */
export const BrandKit = z.object({
  palette: z.object({
    primary: z.string().default(""),
    secondary: z.string().default(""),
    text: z.string().default(""),
    background: z.string().default(""),
  }).prefault({}),
  fonts: z.object({ captions: z.string().default(""), titles: z.string().default("") }).prefault({}),
  logo: z.object({ slot: z.string().default(""), assetId: z.string().default("") }).prefault({}),
}).strict();
export type BrandKit = z.infer<typeof BrandKit>;

/**
 * An intro or outro: a picture held full-frame at the start or the end, on the main
 * track, so everything else shifts to make room. Video bookends arrive with video in
 * the library. Placed as an ordinary canvas item the author can move or remove.
 */
export const TemplateBookend = z.object({
  enabled: z.boolean().default(false),
  slot: z.string().default(""),
  assetId: z.string().default(""),
  seconds: z.number().positive().max(15).default(2),
});
export type TemplateBookend = z.infer<typeof TemplateBookend>;

export const TemplateCard = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]+$/),
  /** 0 = first frame, 1 = last frame, measured on the finished timeline. */
  atFraction: z.number().min(0).max(1),
  /** `{{hook}}`, `{{title}}` and `{{slot:<id>}}` are substituted. */
  text: z.string().min(1),
  seconds: z.number().positive().default(2.5),
  position: z.enum(["top", "center", "bottom"]).default("center"),
  style: z.enum(["card", "plain"]).default("card"),
});
export type TemplateCard = z.infer<typeof TemplateCard>;

export const VideoTemplate = z.object({
  schema: z.literal(1).default(1),
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "Template IDs are lowercase letters, digits and hyphens"),
  /** Start from another template and change some fields. Resolved when the template is read. */
  extends: z.string().optional(),
  name: z.string().min(1),
  description: z.string().default(""),
  author: z.string().default(""),
  tags: z.array(z.string()).default([]),
  /** Applying a template may also set the output format, e.g. 1080x1920 vertical. */
  output: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    fps: z.number().positive(),
  }).optional(),
  captions: TemplateCaptions.default({}),
  /** A named caption look (see looks.ts). Explicit `captions` fields win over it. */
  captionLook: z.string().default(""),
  brand: BrandKit.prefault({}),
  intro: TemplateBookend.prefault({}),
  outro: TemplateBookend.prefault({}),
  /**
   * Per-aspect overrides, keyed "9:16", "1:1", "16:9", "4:5": merged over the template
   * when it is applied to a video of that shape. Positions and sizes are fractions
   * already, so most templates need none; this is for the ones that do.
   */
  variants: z.record(z.string(), z.record(z.string(), z.unknown())).default({}),
  hook: TemplateHook.prefault({}),
  images: TemplateImages.prefault({}),
  rhythm: TemplateRhythm.prefault({}),
  music: TemplateMusic.prefault({}),
  sound: TemplateSound.prefault({}),
  cards: z.array(TemplateCard).default([]),
  watermark: TemplateWatermark.prefault({}),
  slots: z.array(TemplateSlot).default([]),
});
export type VideoTemplate = z.infer<typeof VideoTemplate>;

/** A stored template plus where it came from. `builtin` templates cannot be overwritten in place. */
export type TemplateRecord = VideoTemplate & { builtin: boolean; file: string | null };

