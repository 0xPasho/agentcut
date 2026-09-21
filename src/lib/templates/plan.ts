import { z } from "zod";
import { Clip, type MediaSource, DEFAULT_ITEM_TRANSFORM, type Edl, type SequenceItem, type VideoSequence } from "../edl";
import { applyOperations, type EditorOperation } from "../editor/operations";
import { promoteClipToSequence } from "../editor/editable-timeline";
import { sequenceFrames } from "../sequences";
import { brandsInText, transcriptCasing, type Casing } from "../search/brand";
import { VideoTemplate } from "./schema";
import {
  analyzeSentences, emphasisBeats, punchBeats, redundancyCuts, selectImageCues, silenceCuts, toSentences,
  type BrandMention, type ImageCue, type SentenceAnalysis,
} from "./script";

/**
 * Planning is separated from applying on purpose. A plan needs no network, writes
 * nothing, and answers the only question worth asking before committing: which
 * sentences would get a picture, and what would it look for? Both interfaces show
 * that plan before a template touches the project.
 */

export const SlotValue = z.object({
  /** A folder on this machine whose images become an ordered pool. */
  folder: z.string().optional(),
  /** Asset ids, in the order they should be used. */
  assetIds: z.array(z.string()).optional(),
  assetId: z.string().optional(),
  text: z.string().optional(),
}).strict();
export type SlotValue = z.infer<typeof SlotValue>;

/**
 * A slot key that is present but empty — `{}`, or a blank path — is not a filled slot.
 * Checking the key alone says "filled" for something that supplies nothing, and the
 * failure then surfaces much later as an empty pool instead of a missing input.
 */
export const slotFilled = (value: SlotValue | undefined): boolean =>
  !!value && !!(value.folder?.trim() || value.assetIds?.length || value.assetId?.trim() || value.text?.trim());

export const TemplateTarget = z.object({
  sequenceId: z.string().optional(),
  /** A generated clip. It is promoted in place, keeping its id and edits. */
  clipId: z.string().optional(),
}).strict();

export const TemplateRequest = z.object({
  templateId: z.string().min(1),
  ...TemplateTarget.shape,
  /** Overrides the hook line the template would otherwise derive from the clip. */
  hookText: z.string().optional(),
  slots: z.record(z.string(), SlotValue).default({}),
  /** A deep patch over the stored template, for a one-off change without saving one. */
  overrides: z.record(z.string(), z.unknown()).optional(),
  /** Restrict web image search to these providers. */
  providers: z.array(z.string()).optional(),
});
export type TemplateRequest = z.infer<typeof TemplateRequest>;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Field-level overrides. Arrays replace; objects merge, so `{images:{density:0.7}}` keeps the rest. */
export function mergeTemplate(template: VideoTemplate, overrides: unknown): VideoTemplate {
  if (!isPlainObject(overrides)) return template;
  const merge = (base: unknown, patch: unknown): unknown => {
    if (!isPlainObject(patch)) return patch;
    const target: Record<string, unknown> = isPlainObject(base) ? { ...base } : {};
    for (const [key, value] of Object.entries(patch)) target[key] = merge(target[key], value);
    return target;
  };
  // Identity is not overridable: an override is a variation of this template, not a new one.
  const { id, schema, ...rest } = overrides as Record<string, unknown>;
  void id; void schema;
  return VideoTemplate.parse(merge(structuredClone(template), rest));
}

export type PlannedItem = {
  itemId: string;
  title: string;
  mediaId: string | null;
  /** Clip-relative source seconds available on this shot. */
  durationSec: number;
  sentences: number;
  analyses: SentenceAnalysis[];
  cues: ImageCue[];
  silences: Array<{ type: "silence"; t: number; d: number }>;
  /** Phrases said twice in a row, removed. Also silence edits — a cut is a cut. */
  redundancies: Array<{ type: "silence"; t: number; d: number }>;
  punches: Array<{ type: "punch"; t: number; d: number; scale: number }>;
  emphasis: Array<{ type: "emphasis"; t: number; d: number; words: string[]; color: string }>;
};

export type TemplatePlan = {
  templateId: string;
  templateName: string;
  sequenceId: string;
  /** True when applying will promote a generated clip into a timeline first. */
  promotes: boolean;
  output: VideoSequence["output"];
  hook: { text: string; seconds: number | null; position: string; style: string } | null;
  cards: Array<{ id: string; text: string; atFraction: number; seconds: number }>;
  items: PlannedItem[];
  totals: { sentences: number; images: number; silences: number; redundancies: number; punches: number; emphasis: number };
  warnings: string[];
};

/** Resolve the sequence a template applies to, promoting a generated clip when needed. */
export function resolveTarget(edl: Edl, target: { sequenceId?: string; clipId?: string }) {
  if (target.sequenceId && target.clipId) throw new Error("Choose either a sequence or a clip, not both");
  if (target.clipId) {
    if (edl.sequences.some((s) => s.id === target.clipId)) return { sequenceId: target.clipId, promotes: false };
    if (!edl.clips.some((c) => c.id === target.clipId)) throw new Error(`Clip not found: ${target.clipId}`);
    return { sequenceId: target.clipId, promotes: true };
  }
  if (target.sequenceId) {
    if (edl.sequences.some((s) => s.id === target.sequenceId)) return { sequenceId: target.sequenceId, promotes: false };
    if (edl.clips.some((c) => c.id === target.sequenceId)) return { sequenceId: target.sequenceId, promotes: true };
    throw new Error(`Video not found: ${target.sequenceId}`);
  }
  const options = [...edl.sequences.map((s) => s.id), ...edl.clips.map((c) => c.id)];
  if (options.length === 1) return { sequenceId: options[0], promotes: !edl.sequences.length };
  if (!options.length) throw new Error("This project has no video to apply a template to. Create one first.");
  throw new Error(`This project has several videos. Name one: ${options.join(", ")}`);
}

/** Brand mentions for every sentence, in one pass, so scoring stays synchronous. */
export async function brandMentions(sentences: Array<{ index: number; text: string }>, casing: Casing) {
  const map = new Map<number, BrandMention[]>();
  for (const sentence of sentences) {
    const found = await brandsInText(sentence.text, { casing });
    if (found.length) map.set(sentence.index, found.map(({ brand, match }) => ({ text: match, slug: brand.slug, hex: brand.hex })));
  }
  return map;
}

/**
 * An item with no transcript still takes pictures when the template has a pool to
 * draw from — a folder of screenshots over silent footage is a whole video format.
 * Without words there is nothing to be smart about, so they are spaced evenly.
 */
function evenCues(item: SequenceItem, template: VideoTemplate, budget: number): ImageCue[] {
  const duration = item.clip.end - item.clip.start;
  const step = template.images.durationSec + template.images.minGapSec;
  const count = Math.min(budget, template.images.maxCount, Math.floor(duration / Math.max(0.5, step)));
  return Array.from({ length: Math.max(0, count) }, (_, index) => {
    const t = Math.min(duration - 0.2, (index + 0.5) * (duration / Math.max(1, count)) - template.images.durationSec / 2);
    return {
      sentenceIndex: -1,
      t: Math.max(0, t),
      d: Math.min(template.images.durationSec, duration - Math.max(0, t)),
      query: "",
      subjects: [],
      salience: 0,
    };
  }).filter((cue) => cue.d >= 0.2);
}

export async function planTemplate(
  edl: Edl,
  template: VideoTemplate,
  request: { sequenceId?: string; clipId?: string; hookText?: string; slots?: Record<string, SlotValue> },
  poolSizes: Record<string, number> = {},
): Promise<TemplatePlan> {
  const { sequenceId, promotes } = resolveTarget(edl, request);
  const working = promotes ? promoteClipToSequence(edl, sequenceId) : edl;
  const sequence = working.sequences.find((s) => s.id === sequenceId)!;
  const warnings: string[] = [];

  const poolNames = template.slots.filter((slot) => slot.kind === "imagePool").map((slot) => slot.id);
  let poolBudget = poolNames.reduce((total, id) => total + (poolSizes[id] ?? 0), 0);
  const sourceKinds = template.images.sources.map((source) => source.split(":")[0]);
  for (const slot of template.slots) {
    if (slot.required && !slotFilled(request.slots?.[slot.id])) warnings.push(`Template slot "${slot.label}" is required and was not filled.`);
  }
  const hasPool = poolBudget > 0;

  const items: PlannedItem[] = [];
  const casings = new Set<Casing>();
  for (const item of sequence.items) {
    const duration = item.clip.end - item.clip.start;
    const sentences = toSentences(item.clip.words);
    // Casing is a property of the whole transcript, not of one sentence: a single
    // lowercase line proves nothing, a whole lowercase transcript proves plenty.
    const casing = transcriptCasing(sentences.map(s => s.text).join(" "));
    if (casing !== "mixed" && sentences.length)
      casings.add(casing);
    const analyses = sentences.length ? analyzeSentences(sentences, await brandMentions(sentences, casing), casing) : [];
    // Which sources could answer this shot without being told what to look for.
    const subjectFree = (sourceKinds.includes("slot") && hasPool) || (sourceKinds.includes("frame") && item.mediaId !== null);
    const cues = sentences.length
      ? selectImageCues(analyses, template.images, { subjectFree, clipDuration: duration })
      : template.images.mode === "off" || !subjectFree
        ? []
        : evenCues(item, template, hasPool ? poolBudget : template.images.maxCount);
    if (!sentences.length && hasPool) poolBudget = Math.max(0, poolBudget - cues.length);
    items.push({
      itemId: item.id,
      title: item.clip.title,
      mediaId: item.mediaId,
      durationSec: duration,
      sentences: sentences.length,
      // A plan crosses the network to the browser. Nothing downstream reads the word
      // timings, and repeating the whole transcript inside it would dwarf the plan.
      analyses: analyses.map(analysis => ({ ...analysis, sentence: { ...analysis.sentence, words: [] } })),
      cues,
      silences: silenceCuts(item.clip.words, template.rhythm.silence, duration),
      redundancies: redundancyCuts(item.clip.words, template.rhythm.redundancy, duration),
      punches: punchBeats(analyses, template.rhythm.punch, duration),
      emphasis: emphasisBeats(analyses, template.rhythm.emphasis, duration),
    });
  }

  const totals = items.reduce(
    (sum, item) => ({
      sentences: sum.sentences + item.sentences,
      images: sum.images + item.cues.length,
      silences: sum.silences + item.silences.length,
      redundancies: sum.redundancies + item.redundancies.length,
      punches: sum.punches + item.punches.length,
      emphasis: sum.emphasis + item.emphasis.length,
    }),
    { sentences: 0, images: 0, silences: 0, redundancies: 0, punches: 0, emphasis: 0 },
  );
  // A card at the bottom of the frame occupies the caption band. The dry run can see
  // that coming from the template and the shot's own caption settings.
  const captionedItems = sequence.items.filter((entry) =>
    entry.clip.words.length && (template.captions?.preset ?? entry.clip.captions.preset) !== "none");
  const bottomCards = template.cards.filter((card) => card.position === "bottom");
  if (bottomCards.length && captionedItems.length)
    warnings.push(`${bottomCards.length === 1 ? `The card "${bottomCards[0].id}" sits` : `${bottomCards.length} cards sit`} at the bottom of the frame, where the captions are. Move ${bottomCards.length === 1 ? "it" : "them"} to the centre, or turn captions off.`);

  // A shortfall the dry run can prove without touching the network: more beats than
  // pictures, when pictures are the only place they could come from.
  const supplied = poolNames.reduce((total, id) => total + (poolSizes[id] ?? 0), 0);
  if (template.images.sources.every((source) => source.startsWith("slot")) && totals.images > supplied)
    warnings.push(`${totals.images} beats want a picture but ${supplied === 0 ? "none were supplied" : `only ${supplied} were supplied`}; ${totals.images - supplied} will be left bare.`);
  if (casings.size && template.images.mode !== "off")
    warnings.push(casings.has("lower")
      ? "This transcript has no capitalisation, so names cannot be read from it. Companies and products are still recognised by name; anything else will be left bare."
      : "This transcript is written in capitals, so names cannot be read from it. Companies and products are still recognised by name; anything else will be left bare.");
  if (!totals.images && template.images.mode !== "off" && totals.sentences)
    warnings.push("No sentence here earns a picture: these sources need the script to name something it can look for, and none of it does.");
  if (!totals.sentences && template.images.mode !== "off" && !hasPool)
    warnings.push("No transcript on this video, so there is nothing to place pictures against. Fill an image pool slot, or add transcript words in scene properties.");

  const hookText = hookLine(template, sequence, request.hookText, request.slots);
  return {
    templateId: template.id,
    templateName: template.name,
    sequenceId,
    promotes,
    output: template.output ?? sequence.output,
    hook: template.hook.mode === "off" || !hookText ? null : {
      text: hookText,
      seconds: template.hook.mode === "sticky" ? null : template.hook.seconds ?? 3,
      position: template.hook.position,
      style: template.hook.style,
    },
    // A card whose text is entirely an unfilled slot is not a blank card, it is no
    // card. Structure the template offers and the author declined to fill.
    cards: template.cards.flatMap((card) => {
      const text = substitute(card.text, { hook: hookText, title: sequence.title }, request.slots).trim();
      return text ? [{ id: card.id, text, atFraction: card.atFraction, seconds: card.seconds }] : [];
    }),
    items,
    totals,
    warnings,
  };
}

function substitute(text: string, values: { hook: string; title: string }, slots?: Record<string, SlotValue>) {
  return text
    .replace(/\{\{\s*hook\s*\}\}/gi, values.hook)
    .replace(/\{\{\s*title\s*\}\}/gi, values.title)
    .replace(/\{\{\s*slot:([a-zA-Z0-9_-]+)\s*\}\}/gi, (_, id: string) => slots?.[id]?.text ?? "");
}

/** The hook is the one line that has to be right; take the most specific source available. */
export function hookLine(template: VideoTemplate, sequence: VideoSequence, override?: string, slots?: Record<string, SlotValue>): string {
  // A hook someone wrote beats any title; a shot's title beats a canvas layer's. Array
  // order is not meaning: after a few edits, a hand-placed title can sit first in it.
  const hooked = sequence.items.find((item) => item.clip.hook.trim());
  const shot = sequence.items.find((item) => item.mediaId !== null && item.clip.title.trim()) ?? sequence.items.find((item) => item.clip.title.trim());
  const raw = (override ?? "").trim()
    || substitute(template.hook.text, { hook: "", title: sequence.title }, slots).trim()
    || (hooked?.clip.hook ?? "").trim()
    || (shot?.clip.title ?? "").trim()
    || sequence.title.trim();
  const words = raw.split(/\s+/).filter(Boolean).slice(0, template.hook.maxWords);
  const line = words.join(" ").replace(/[.,;:]$/, "");
  return template.hook.uppercase ? line.toUpperCase() : line;
}

export const templateAuthor = (templateId: string) => `template:${templateId}`;
export const isTemplateEdit = (edit: { by: string }) => edit.by.startsWith("template:");
/**
 * Who a canvas layer belongs to now. A layer whose every edit a template wrote and
 * whose placement is still what the template gave it is the template's own to replace.
 * The moment a person adds an edit to it, it is theirs; the moment they move, resize,
 * rotate or retime it, it is theirs too — a nudged watermark must survive a re-apply,
 * and the template must not put a second one back in the corner beside it.
 */
export type TemplateItemState = "owned" | "moved" | "hand";
/** An intro or outro: a picture for some seconds, or a library video played whole (added as media when new). */
export type Bookend = { src: string; seconds: number } | { media: MediaSource; addMedia: boolean; seconds: number };
export function templateItemState(item: SequenceItem): TemplateItemState {
  // A video bookend has footage and no edits; its mark is on the clip itself.
  if (item.mediaId !== null && ["Intro", "Outro"].includes(item.clip.title) && item.clip.reason.startsWith("template:") && !item.clip.edits.length)
    return item.at !== null && item.at !== undefined ? "moved" : "owned";
  if (item.mediaId !== null || !item.clip.edits.length || !item.clip.edits.some(isTemplateEdit)) return "hand";
  if (!item.clip.edits.every(isTemplateEdit)) return "hand";
  const t = item.transform;
  const placed = !!t && (t.x !== DEFAULT_ITEM_TRANSFORM.x || t.y !== DEFAULT_ITEM_TRANSFORM.y ||
    t.width !== DEFAULT_ITEM_TRANSFORM.width || t.height !== DEFAULT_ITEM_TRANSFORM.height || t.rotation !== DEFAULT_ITEM_TRANSFORM.rotation);
  // Layers a template always starts at zero: a nonzero start is a person's decision.
  const retimed = ["Hook", "Watermark", "Music bed"].includes(item.clip.title) && (item.at ?? 0) !== 0;
  // A bookend is placed on the main track with automatic timing; a pinned time is a person's decision.
  const repinned = ["Intro", "Outro"].includes(item.clip.title) && (item.at !== null && item.at !== undefined);
  if (repinned) return "moved";
  return placed || retimed ? "moved" : "owned";
}
export const isTemplateItem = (item: SequenceItem) => templateItemState(item) === "owned";

export type ResolvedImage = {
  src: string;
  credit: string;
  style: "card" | "plain" | "logo";
  x: number | null;
  widthPct: number;
  heightPct: number;
  caption: string;
};

/**
 * Build the operations. Pure: every picture has already been resolved to an asset
 * id by the caller, so this is the same function whether a human pressed Apply or
 * an agent called the tool.
 */
export function templateOperations(
  edl: Edl,
  template: VideoTemplate,
  plan: TemplatePlan,
  resolved: Map<string, ResolvedImage[]>,
  newId: (prefix: string) => string,
  music?: { src: string } | null,
  watermark?: { src: string } | null,
  author?: string,
  bookends: { intro?: Bookend | null; outro?: Bookend | null } = {},
  /** The template's sounds, already resolved to assets: on every punch-in, on every cut, on the first frame. */
  sounds: { punch?: { src: string } | null; transitions?: { src: string } | null; opener?: { src: string } | null } = {},
): EditorOperation[] {
  const by = author ?? templateAuthor(template.id);
  if (!isTemplateEdit({ by })) throw new Error("A template author must start with template:");
  const operations: EditorOperation[] = [];
  let working = edl;
  const push = (...batch: EditorOperation[]) => {
    operations.push(...batch);
    working = applyOperations(working, batch);
  };

  if (plan.promotes) push({ type: "clip.promote", clipId: plan.sequenceId });
  const sequenceOf = () => working.sequences.find((s) => s.id === plan.sequenceId)!;
  if (template.output && JSON.stringify(template.output) !== JSON.stringify(sequenceOf().output))
    push({ type: "sequence.patch", sequenceId: plan.sequenceId, output: template.output });

  for (const item of sequenceOf().items.filter(isTemplateItem))
    push({ type: "item.remove", sequenceId: plan.sequenceId, itemId: item.id });
  // A template layer someone has moved stays where they put it, and the template does
  // not add a second one of the same kind beside it.
  const kept = new Set(sequenceOf().items.filter((item) => templateItemState(item) === "moved").map((item) => item.clip.title));

  for (const planned of plan.items) {
    const item = sequenceOf().items.find((candidate) => candidate.id === planned.itemId);
    if (!item) continue;
    // A layer the template has nothing to say about — a title someone placed by hand,
    // a shot with no transcript — is left exactly as it is rather than restyled with
    // caption settings that have no words to apply to. Its own past output still goes.
    if (!planned.sentences && !planned.cues.length && !item.clip.edits.some(isTemplateEdit)) continue;
    const images = planned.cues.flatMap((cue, index) =>
      (resolved.get(`${planned.itemId}:${index}`) ?? []).map((image) => ({
        type: "image" as const,
        t: cue.t,
        d: cue.d,
        src: image.src,
        query: cue.query,
        credit: image.credit,
        y: template.images.y,
        x: image.x,
        widthPct: image.widthPct,
        heightPct: image.heightPct,
        style: image.style,
        caption: image.caption,
        by,
      })));
    const sfx = template.rhythm.punch.sfx;
    const generated = [
      ...planned.silences.map((edit) => ({ ...edit, by })),
      ...planned.redundancies.map((edit) => ({ ...edit, by })),
      ...planned.punches.map((edit) => ({ ...edit, by })),
      ...(sounds.punch ? planned.punches.map((edit) => ({ type: "sfx" as const, t: edit.t, d: Math.min(sfx.durationSec, edit.d), src: sounds.punch!.src, gain: sfx.gain, by })) : []),
      ...planned.emphasis.map((edit) => ({ ...edit, by })),
      ...images,
    ];
    const kept = item.clip.edits.filter((edit) => !isTemplateEdit(edit));
    const edits = [...kept, ...generated];
    const captions = template.captions ?? {};
    // An unchanged shot is not worth a revision entry or a conflict surface.
    if (!generated.length && !Object.keys(captions).length && kept.length === item.clip.edits.length) continue;
    push({ type: "item.patch", sequenceId: plan.sequenceId, itemId: planned.itemId, patch: { edits, ...(Object.keys(captions).length ? { captions } : {}) } });
  }

  // Bookends sit on the main track, so they go in before anything is measured: an
  // intro shifts every shot after it, and the hook and music span the result.
  const bookend = (which: "Intro" | "Outro", b: Bookend): EditorOperation[] => {
    const id = newId("i");
    const add = {
      type: "item.add" as const,
      sequenceId: plan.sequenceId,
      ...(which === "Intro" ? { index: 0 } : {}),
      item: "media" in b
        // A video bookend is a real shot. `reason` carries the template's mark, since a shot has no edits to carry it.
        ? { id, mediaId: b.media.id, layer: 0, clip: Clip.parse({ id, title: which, start: 0, end: b.seconds, reason: by, captions: { preset: "none" } }) }
        : { id, mediaId: null, layer: 0, clip: Clip.parse({ id, title: which, start: 0, end: b.seconds, captions: { preset: "none" },
            edits: [{ type: "image", t: 0, d: b.seconds, src: b.src, query: "", credit: "", x: 0.5, y: 0.5, widthPct: 100, heightPct: 100, style: "plain", caption: "", by }] }) },
    };
    return "media" in b && b.addMedia && !working.media.some((m) => m.id === b.media.id) ? [{ type: "media.add", media: b.media }, add] : [add];
  };
  if (bookends.intro && !kept.has("Intro")) push(...bookend("Intro", bookends.intro));
  if (bookends.outro && !kept.has("Outro")) push(...bookend("Outro", bookends.outro));

  const sequence = sequenceOf();
  const duration = sequenceFrames(sequence).duration / sequence.output.fps;
  const topLayer = sequence.items.reduce((highest, item) => Math.max(highest, item.layer ?? 0), 0);

  const canvasItem = (layer: number, at: number, seconds: number, title: string, text: string, position: "top" | "center" | "bottom", style: "card" | "plain") => {
    const id = newId("i");
    const length = Math.max(0.2, Math.min(seconds, duration - at));
    return {
      type: "item.add" as const,
      sequenceId: plan.sequenceId,
      item: {
        id,
        mediaId: null,
        clip: Clip.parse({ id, title, start: 0, end: length, captions: { preset: "none" }, edits: [{ type: "text", t: 0, d: length, text, position, style, by }] }),
        at,
        layer,
      },
    };
  };

  if (plan.hook && !kept.has("Hook")) push(canvasItem(topLayer + 1, 0, plan.hook.seconds ?? duration, "Hook", plan.hook.text, template.hook.position, template.hook.style));
  for (const card of plan.cards) {
    if (kept.has(`Card: ${card.id}`)) continue;
    // A card is pinned by its start until that would push its end past the video;
    // from there it backs off, so `atFraction: 1` means "ends on the last frame"
    // rather than "starts after it" and a late card is never squeezed to nothing.
    const at = Math.max(0, Math.min(card.atFraction * duration, duration - card.seconds));
    const definition = template.cards.find((candidate) => candidate.id === card.id)!;
    push(canvasItem(topLayer + 2, at, card.seconds, `Card: ${card.id}`, card.text, definition.position, definition.style));
  }
  if (watermark?.src && !kept.has("Watermark")) {
    const id = newId("i");
    const mark = template.watermark;
    // The overlay is positioned by its centre, so half of it has to clear the margin.
    // Height is estimated from a square mark; a wide logo hangs a little lower and is
    // an ordinary item the author can nudge.
    const halfHeight = (mark.widthPct / 100) * (sequence.output.width / sequence.output.height) / 2;
    const halfWidth = mark.widthPct / 200;
    const margin = mark.marginPct / 100;
    push({
      type: "item.add",
      sequenceId: plan.sequenceId,
      item: {
        id,
        mediaId: null,
        at: 0,
        layer: topLayer + 4,
        transform: { ...DEFAULT_ITEM_TRANSFORM, opacity: mark.opacity },
        clip: Clip.parse({
          id, title: "Watermark", start: 0, end: duration, captions: { preset: "none" },
          edits: [{
            type: "image", t: 0, d: duration, src: watermark.src, query: "", credit: "",
            x: mark.corner.endsWith("left") ? margin + halfWidth : 1 - margin - halfWidth,
            y: mark.corner.startsWith("top") ? margin + halfHeight : 1 - margin - halfHeight,
            // Boxed to the square the corner maths assumed, so a tall mark is
            // letterboxed rather than climbing out of its corner.
            widthPct: mark.widthPct, heightPct: Math.max(5, halfHeight * 200), style: "plain", caption: "", by,
          }],
        }),
      },
    });
  }
  if (music?.src && !kept.has("Music bed")) {
    const id = newId("i");
    push({
      type: "item.add",
      sequenceId: plan.sequenceId,
      item: {
        id,
        mediaId: null,
        clip: Clip.parse({
          id, title: "Music bed", start: 0, end: duration, captions: { preset: "none" },
          edits: [{ type: "music", t: 0, d: duration, src: music.src, gain: template.music.gain, duck: template.music.duck, loop: template.music.loop, by }],
        }),
        at: 0,
        layer: topLayer + 3,
      },
    });
  }

  /** One canvas layer holding a set of stings, the way the music bed is one layer holding a bed. */
  const soundLayer = (title: string, src: string, gain: number, times: Array<{ t: number; d: number }>) => {
    const id = newId("i");
    return {
      type: "item.add" as const,
      sequenceId: plan.sequenceId,
      item: {
        id, mediaId: null, at: 0, layer: topLayer + 5,
        clip: Clip.parse({
          id, title, start: 0, end: duration, captions: { preset: "none" },
          edits: times.map(({ t, d }) => ({ type: "sfx" as const, t, d, src, gain, by })),
        }),
      },
    };
  };

  if (sounds.transitions && !kept.has("Transitions")) {
    // Every cut between shots on the main track except the first frame, which is the
    // opener's job. A sting on a cut nobody can hear yet is just a sting on silence.
    const main = sequenceFrames(sequence).items
      .filter((entry) => (entry.item.layer ?? 0) === 0)
      .sort((a, b) => a.from - b.from)
      .slice(1)
      .map((entry) => entry.from / sequence.output.fps)
      .filter((t) => t > 0.05 && t < duration - 0.05);
    const length = template.sound.transitions.durationSec;
    if (main.length) push(soundLayer("Transitions", sounds.transitions.src, template.sound.transitions.gain, main.map((t) => ({ t, d: Math.min(length, duration - t) }))));
  }
  if (sounds.opener && !kept.has("Opener"))
    push(soundLayer("Opener", sounds.opener.src, template.sound.opener.gain, [{ t: 0, d: Math.min(template.sound.opener.durationSec, duration) }]));

  return operations;
}

