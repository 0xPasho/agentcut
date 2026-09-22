import type { Edl } from "../../editor/types";
import { transcriptCasing } from "../../media/server/search/brand";
import { listTemplates } from "../server/registry";
import type { TemplateRecord, VideoTemplate } from "../types";
import { analyzeSentences, toSentences } from "./script";
import { brandMentions, planTemplate, resolveTarget, slotFilled, type SlotValue, type TemplatePlan } from "./plan";
import { promoteClipToSequence } from "../../editor/lib/editable-timeline";

/**
 * Which template this video wants. The agent is handed the list of templates and
 * asked to choose; so is a person opening the panel. Neither can see the shape of
 * the material at a glance, and this measures it: how much of the script names
 * something, whether those names are companies, whether there is footage at all.
 *
 * Templates are scored by their own settings rather than by id, so a template a
 * user wrote this morning is ranked on the same evidence as a built-in.
 */

export type SequenceSignals = {
  sequenceId: string;
  sentences: number;
  /** Share of sentences naming a company or product. */
  brandShare: number;
  /** Share of sentences naming anything at all. */
  subjectShare: number;
  hasFootage: boolean;
  hasPool: boolean;
  durationSec: number;
  casing: "mixed" | "upper" | "lower";
  /**
   * The shape of the footage, widest first. A template that stacks a screen above a
   * person needs a frame with both in it; a video already shot upright has no screen
   * beside the speaker to stack, and a split of it is two crops of the same face.
   */
  sourceAspect: number | null;
};

export async function sequenceSignals(
  edl: Edl,
  target: { sequenceId?: string; clipId?: string },
  slots: Record<string, SlotValue> = {},
): Promise<SequenceSignals> {
  const { sequenceId, promotes } = resolveTarget(edl, target);
  const working = promotes ? promoteClipToSequence(edl, sequenceId) : edl;
  const sequence = working.sequences.find((s) => s.id === sequenceId)!;

  let sentences = 0;
  let withBrand = 0;
  let withSubject = 0;
  let durationSec = 0;
  let casing: SequenceSignals["casing"] = "mixed";
  for (const item of sequence.items) {
    durationSec += item.clip.end - item.clip.start;
    const split = toSentences(item.clip.words);
    if (!split.length) continue;
    const itemCasing = transcriptCasing(split.map((s) => s.text).join(" "));
    if (itemCasing !== "mixed") casing = itemCasing;
    const analyses = analyzeSentences(split, await brandMentions(split, itemCasing), itemCasing);
    sentences += analyses.length;
    withBrand += analyses.filter((a) => a.brands.length).length;
    withSubject += analyses.filter((a) => a.subjects.length).length;
  }
  return {
    sequenceId,
    sentences,
    brandShare: sentences ? withBrand / sentences : 0,
    subjectShare: sentences ? withSubject / sentences : 0,
    hasFootage: sequence.items.some((item) => item.mediaId !== null),
    sourceAspect: sequence.items.reduce((widest: number | null, item) => {
      const media = item.mediaId ? working.media.find((m) => m.id === item.mediaId) : null;
      if (!media?.width || !media.height) return widest;
      const aspect = media.width / media.height;
      return widest === null ? aspect : Math.max(widest, aspect);
    }, null),
    hasPool: Object.values(slots).some((value) => slotFilled(value) && (value.folder || value.assetIds?.length)),
    durationSec,
    casing,
  };
}

export type TemplateSuggestion = {
  templateId: string;
  name: string;
  builtin: boolean;
  /** 0..1. Anything below 0.35 is offered only because something must be first. */
  fit: number;
  /** Why it scored what it scored, in the order the reasons were applied. */
  why: string[];
  /** Roughly how many pictures it would place, before any of them fail to resolve. */
  expectedImages: number;
  /** Named slots that must be filled before it can be applied at all. */
  missingSlots: string[];
};

const sourceKinds = (template: VideoTemplate) => template.images.sources.map((s) => s.split(":")[0]);

/**
 * How many pictures a template would place is not estimated here. It is whatever the
 * planner says, because the planner is what will actually run. A second model of the
 * same rule drifts from it silently — and did: it predicted pictures for a template
 * whose sources could not place one.
 */
function score(template: TemplateRecord, signals: SequenceSignals, slots: Record<string, SlotValue>, plan: TemplatePlan) {
  const why: string[] = [];
  const sources = sourceKinds(template);
  const missingSlots = template.slots
    .filter((slot) => slot.required && !slotFilled(slots[slot.id]))
    .map((slot) => slot.label);
  let points = 0;

  if (missingSlots.length) {
    why.push(`needs ${missingSlots.join(" and ")} before it can be applied`);
    points -= 100;
  }

  const wantsPictures = template.images.mode !== "off";
  const expectedImages = plan.totals.images;
  if (!signals.sentences) {
    if (!wantsPictures) { points += 40; why.push("needs no transcript"); }
    else if (expectedImages) { points += 35; why.push("uses your pictures in order, which needs no transcript"); }
    else { points -= 30; why.push("places pictures against the script, and this video has no transcript yet"); }
  } else if (!wantsPictures) {
    points += 10;
    if (signals.subjectShare < 0.25) { points += 25; why.push("little in this script names anything to show"); }
    else why.push("leaves the speaker alone");
  } else if (!expectedImages) {
    // Grounded in the plan, so this can never be wrong about its own template again.
    points -= 30;
    why.push("would place no pictures on this script at all");
  } else {
    // Some sources need a name to look up; some only need a moment. Which it is
    // changes what the script has to provide.
    const subjectFree = (sources.includes("slot") && signals.hasPool) || (sources.includes("frame") && signals.hasFootage);
    if (signals.hasPool && sources[0]?.startsWith("slot")) { points += 35; why.push("your pictures come first"); }
    else if (subjectFree) { points += 30; why.push("takes its pictures from this footage, so the script never has to name anything"); }
    // Being in the list is not the same as being reached. Resolution stops at the
    // first source that answers, and a frame over real footage always answers — so
    // `["frame","brand"]` never shows a logo, however many the script names.
    const brandAt = sources.indexOf("brand");
    const alwaysAnswers = (kind: string) => (kind === "frame" && signals.hasFootage) || (kind === "slot" && signals.hasPool) || kind === "web";
    const reachesBrand = brandAt >= 0 && !sources.slice(0, brandAt).some(alwaysAnswers);
    const named = Math.round(signals.brandShare * 100);
    if (signals.brandShare >= 0.3 && reachesBrand) {
      points += 35;
      why.push(`${named}% of sentences name a company or product, and this reaches for the logo first`);
      if (template.images.density >= signals.brandShare) { points += 5; why.push("and is dense enough to show them all"); }
    } else {
      if (signals.subjectShare >= 0.3 && !subjectFree) {
        points += 25;
        why.push(`${Math.round(signals.subjectShare * 100)}% of sentences name something it can illustrate`);
      } else if (signals.subjectShare < 0.15 && !subjectFree) {
        points -= 20;
        why.push("few sentences here name anything, so most beats would come back empty");
      }
      if (signals.brandShare >= 0.3) { points -= 10; why.push(`but ${named}% of them are companies whose logo it would never reach`); }
    }
    if (template.images.mode === "auto") { points += 10; why.push("illustrates only where it helps"); }
    if (template.images.mode === "every") { points -= 10; why.push("illustrates every sentence it can, which is a lot"); }
    // Said, not scored. A picture over a talking head is the point of a picture; a
    // picture over a screen recording covers the thing the video is about, and whether
    // that matters is the author's call — but they cannot make it without being told.
    // The shape of the footage is all the evidence there is: wide enough for a screen
    // and a speaker is the same test the framing bonus makes.
    if (signals.hasFootage && template.layout.mode !== "split" && (signals.sourceAspect ?? 0) >= 1.2)
      why.push(`this footage is a wide frame, the shape a screen recording has, and ${expectedImages} ${expectedImages === 1 ? "picture" : "pictures"} would cover what is on it while they show`);
  }

  if (sources.includes("frame")) {
    if (signals.hasFootage) { points += 10; why.push("can cut stills out of the footage itself"); }
    else { points -= 20; why.push("wants stills from footage this video does not have"); }
  }
  // Framing is the loudest thing a template does to a video, and the only one that can
  // be wrong on evidence rather than on taste: a split needs a frame with a screen and
  // a person in it.
  if (template.layout.mode === "split") {
    if (!signals.hasFootage) { points -= 40; why.push("stacks a screen above a speaker, and this video has no footage"); }
    else if (signals.sourceAspect === null) { points -= 5; why.push("stacks a screen above a speaker, and the shape of this footage is unknown"); }
    else if (signals.sourceAspect < 1.2) {
      points -= 35;
      why.push("this footage is already upright, so there is no screen beside the speaker to stack");
    } else {
      points += 25;
      why.push("this footage is a wide screen with room for a speaker in a corner of it, which is what a split is for");
    }
  }
  if (signals.casing !== "mixed" && wantsPictures && !sources.includes("slot")) {
    points -= 10;
    why.push("this transcript has no usable capitalisation, so only company and product names will be found");
  }
  // The planner's own warnings are already sentences a person can act on.
  why.push(...plan.warnings);

  return {
    templateId: template.id,
    name: template.name,
    builtin: template.builtin,
    // 60 points is a template that fits on every axis; the clamp keeps the number readable.
    fit: Math.max(0, Math.min(1, (points + 20) / 80)),
    why,
    expectedImages,
    missingSlots,
  };
}

export async function suggestTemplates(
  edl: Edl,
  target: { sequenceId?: string; clipId?: string },
  slots: Record<string, SlotValue> = {},
): Promise<{ signals: SequenceSignals; suggestions: TemplateSuggestion[] }> {
  const signals = await sequenceSignals(edl, target, slots);
  const suggestions: TemplateSuggestion[] = [];
  // Counted once, the same way the dry run and the apply path count; a folder is
  // never assumed full here either, or a suggestion's shortfall warning could not fire.
  const { countPools } = await import("../server/apply");
  const { sizes } = await countPools(slots);
  // A shortlist is a decision already made: ranking templates outside it would be
  // answering a question nobody asked.
  const shortlist = new Set(edl.plan.templates);
  const available = (await listTemplates()).filter(t => !shortlist.size || shortlist.has(t.id));
  for (const template of (available.length ? available : await listTemplates())) {
    // Planning is pure and offline; it touches no network and writes nothing.
    const plan = await planTemplate(edl, template, { ...target, slots }, sizes);
    suggestions.push(score(template, signals, slots, plan));
  }
  return { signals, suggestions: suggestions.sort((a, b) => b.fit - a.fit || a.name.localeCompare(b.name)) };
}
