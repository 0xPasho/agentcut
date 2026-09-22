import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { q, type AssetRow } from "../db";
import { kindFor } from "../assets";
import { localPath, importLocalAsset } from "../editor/local-assets";
import { promoteClipToSequence } from "../editor/editable-timeline";
import { MediaSource, type SequenceItem } from "../edl";
import type { Bookend } from "./plan";
import { editProject, readEditor, RevisionConflict } from "../editor/store";
import { adoptAudioHit, adoptHit, brandHit, findBrand, resolveQueryDetailed, searchAudio, type AudioKind } from "../search";
import { getTemplate } from "./registry";
import { aspectOf, resolveTemplate } from "./resolve";
import type { VideoTemplate } from "./schema";
import type { ImageCue, Subject } from "./script";
import {
  mergeTemplate, planTemplate, slotFilled, templateOperations, TemplateRequest, resolveTarget,
  type PlannedItem, type ResolvedImage, type SlotValue, type TemplatePlan,
} from "./plan";

/**
 * Turning a plan into a finished edit needs the outside world: folders, the asset
 * library, a logo CDN, an image search. That is all this file does. The decisions
 * were already made by the planner, and the edit itself is made by the shared
 * operation engine — so the human button and the agent tool cannot diverge.
 */

const MAX_POOL = 200;

/** Every image in a folder, in filename order. Ordered, because a story has an order. */
async function folderImages(folder: string): Promise<{ root: string; files: string[] }> {
  const root = await fs.realpath(localPath(folder));
  const entries = await fs.readdir(root, { withFileTypes: true });
  return {
    root,
    files: entries
      .filter((entry) => entry.isFile() && !entry.name.startsWith(".") && kindFor(entry.name) === "image")
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }))
      .slice(0, MAX_POOL),
  };
}

/**
 * A pool entry is either an asset already in the project or a file still in its
 * folder. Files are imported as they are handed out, not up front: a folder of two
 * hundred screenshots that the plan consumes six of costs six copies, not two hundred.
 */
type PoolEntry = { id: string } | { file: string };
type Pool = { entries: PoolEntry[]; cursor: number };

/**
 * A required slot is a refusal, not a warning. Only pools enforced it, so a template
 * that required an end card or a music bed applied happily without one and the missing
 * input showed up as a video that was simply missing its ending. Checked before
 * anything is imported, so a request that will be refused costs nothing.
 */
function requireSlots(template: VideoTemplate, slots: Record<string, SlotValue>) {
  for (const slot of template.slots) {
    if (!slot.required || slotFilled(slots[slot.id])) continue;
    throw new Error(`This template needs "${slot.label}". Fill the "${slot.id}" slot.`);
  }
}

async function buildPools(template: VideoTemplate, slots: Record<string, SlotValue>) {
  const pools = new Map<string, Pool>();
  for (const slot of template.slots) {
    if (slot.kind !== "imagePool") continue;
    const value = slots[slot.id];
    if (!slotFilled(value)) {
      if (slot.required) throw new Error(`This template needs "${slot.label}". Give it a folder of images or a list of asset ids.`);
      continue;
    }
    let entries: PoolEntry[] = [];
    if (value!.assetIds?.length) entries = value!.assetIds.map((id) => ({ id }));
    else if (value!.folder) {
      const { root, files } = await folderImages(value!.folder);
      if (!files.length) throw new Error(`No images in ${root}. Choose a folder containing pictures.`);
      entries = files.map((name) => ({ file: path.join(root, name) }));
    }
    if (!entries.length && slot.required) throw new Error(`"${slot.label}" resolved to no images.`);
    if (entries.length) pools.set(slot.id, { entries, cursor: 0 });
  }
  return pools;
}

const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

type Context = {
  projectId: string;
  template: VideoTemplate;
  pools: Map<string, Pool>;
  projectImages: AssetRow[];
  /** From the timeline the operations will produce, which may not be saved yet. */
  media: MediaSource[];
  providers?: string[];
  credits: Map<string, string>;
  /** One fetch per brand per apply, however many sentences name it. */
  brandAssets: Map<string, AssetRow | null>;
};

/** The next unused picture, imported now if it is still a file. */
async function takeFromPool(context: Context, id?: string): Promise<AssetRow | null> {
  const candidates = id ? [context.pools.get(id)].filter((pool): pool is Pool => !!pool) : [...context.pools.values()];
  for (const pool of candidates) {
    if (pool.cursor >= pool.entries.length) continue;
    const entry = pool.entries[pool.cursor++];
    if ("id" in entry) return q.getAsset(entry.id) ?? null;
    return importLocalAsset(context.projectId, entry.file);
  }
  return null;
}

/**
 * An image already in this project or the library whose name or tags name the subject.
 * Whole words only: "AI" must not find "train-station.jpg", nor "Go" find "logo.png".
 */
function matchProjectAsset(assets: AssetRow[], subject: string): AssetRow | null {
  const needle = normalize(subject).split(" ").filter(Boolean);
  if (!needle.length) return null;
  return assets.find((asset) => {
    const words = normalize(`${asset.name.replace(/\.[a-z0-9]+$/i, "")} ${asset.tags}`).split(" ").filter(Boolean);
    return needle.every((word) => words.includes(word));
  }) ?? null;
}

async function adoptBrand(context: Context, subject: Subject): Promise<AssetRow | null> {
  const found = subject.brandSlug ? { slug: subject.brandSlug, hex: subject.brandHex ?? "000000", title: subject.text, aliases: [] } : await findBrand(subject.text);
  if (!found) return null;
  if (!context.brandAssets.has(found.slug)) context.brandAssets.set(found.slug, await adoptHit(brandHit(found), context.projectId).catch(() => null));
  return context.brandAssets.get(found.slug) ?? null;
}

const styleFor = (template: VideoTemplate, isLogo: boolean): ResolvedImage["style"] =>
  template.images.style === "auto" ? (isLogo ? "logo" : "card") : template.images.style;

const captionFor = (template: VideoTemplate, subject: Subject | undefined) =>
  template.images.caption === "subject" ? subject?.text ?? "" : "";

/**
 * What each source had to say about one beat. A picture that never appears looks
 * identical whichever source declined and for whichever reason, so the reasons are
 * carried out rather than swallowed — that is how a template gets improved.
 */
export type CueAttempt = {
  source: string;
  /** `used` placed it, `skipped` had nothing to work with, `empty` looked and found nothing, `failed` broke. */
  outcome: "used" | "skipped" | "empty" | "failed";
  detail?: string;
};
export type CueResolution = { images: ResolvedImage[]; attempts: CueAttempt[] };

/**
 * Walk the template's sources in order and stop at the first that answers. A brand
 * name ahead of a photo search is what makes "Google" the Google mark; a pool
 * ahead of everything is what makes a screenshot folder win over a stock photo.
 */
async function resolveCue(context: Context, item: SequenceItem, cue: ImageCue): Promise<CueResolution> {
  const { template } = context;
  const attempts: CueAttempt[] = [];
  const note = (source: string, outcome: CueAttempt["outcome"], detail?: string) => { attempts.push({ source, outcome, detail }); };
  const single = (asset: AssetRow, isLogo: boolean, subject?: Subject): ResolvedImage[] => {
    if (asset.attribution) context.credits.set(asset.id, asset.attribution);
    const style = styleFor(template, isLogo);
    return [{
      src: asset.id, credit: asset.attribution ?? "", style,
      x: template.images.x,
      widthPct: style === "logo" ? template.images.logoWidthPct : template.images.widthPct,
      heightPct: template.images.heightPct,
      caption: captionFor(template, subject),
    }];
  };

  for (const source of template.images.sources) {
    const [kind, argument] = source.split(":");
    if (kind === "slot") {
      if (!context.pools.size) { note(source, "skipped", "no pictures were supplied"); continue; }
      let asset: AssetRow | null = null;
      try { asset = await takeFromPool(context, argument); }
      catch (error) { note(source, "failed", (error as Error).message); continue; }
      if (asset) { note(source, "used"); return { images: single(asset, false, cue.subjects[0]), attempts }; }
      note(source, "empty", "the folder ran out of pictures");
      continue;
    }
    if (kind === "brand") {
      const brands = cue.subjects.filter((subject) => subject.kind === "brand");
      if (!brands.length) { note(source, "skipped", "this sentence names no company or product"); continue; }
      if (template.images.pairBrands && brands.length >= 2) {
        const pair = await Promise.all(brands.slice(0, 2).map((subject) => adoptBrand(context, subject)));
        if (pair[0] && pair[1]) {
          // Two plates side by side each get less than one would.
          const paired = Math.min(template.images.logoWidthPct, 40);
          note(source, "used", `${brands[0].text} and ${brands[1].text}`);
          return { attempts, images: pair.map((asset, index): ResolvedImage => {
            if (asset!.attribution) context.credits.set(asset!.id, asset!.attribution);
            return {
              src: asset!.id, credit: asset!.attribution ?? "", style: styleFor(template, true),
              x: index === 0 ? 0.27 : 0.73, widthPct: paired, heightPct: template.images.heightPct,
              caption: captionFor(template, brands[index]),
            };
          }) };
        }
      }
      const asset = await adoptBrand(context, brands[0]);
      if (asset) { note(source, "used", brands[0].text); return { images: single(asset, true, brands[0]), attempts }; }
      note(source, "failed", `no mark could be fetched for “${brands[0].text}”`);
      continue;
    }
    if (kind === "project") {
      for (const subject of cue.subjects) {
        const asset = matchProjectAsset(context.projectImages, subject.text);
        if (asset) { note(source, "used", asset.name); return { images: single(asset, subject.kind === "brand", subject), attempts }; }
      }
      note(source, cue.subjects.length ? "empty" : "skipped",
        cue.subjects.length ? "nothing already in this project is named after it" : "this sentence names nothing to match against");
      continue;
    }
    if (kind === "frame") {
      const media = item.mediaId ? context.media.find((entry) => entry.id === item.mediaId) : undefined;
      if (!media) { note(source, "skipped", "this shot has no footage to capture from"); continue; }
      const { captureFrameAsset } = await import("../editor/tools");
      const at = item.clip.start + cue.t;
      try {
        note(source, "used");
        return { images: single(await captureFrameAsset(context.projectId, media, at), false, cue.subjects[0]), attempts };
      } catch (error) {
        attempts.pop();
        note(source, "failed", (error as Error).message);
        continue;
      }
    }
    if (kind === "web") {
      if (!cue.query) { note(source, "skipped", "this sentence names nothing to search for"); continue; }
      const providers = argument ? [argument] : context.providers;
      const result = await resolveQueryDetailed(cue.query, context.projectId, providers);
      if (result.asset) { note(source, "used", cue.query); return { images: single(result.asset, false, cue.subjects[0]), attempts }; }
      note(source, result.reason === "no-match" ? "empty" : "failed",
        result.reason === "no-match" ? `no picture matched “${cue.query}” well enough to use` : result.detail);
      continue;
    }
  }
  return { images: [], attempts };
}

/** A slot-or-literal asset of a required kind, or null when the author left it empty. */
function resolveSlotAsset(
  setting: { enabled: boolean; slot: string; assetId: string },
  slots: Record<string, SlotValue>,
  kind: "audio" | "image",
  label: string,
) {
  if (!setting.enabled) return null;
  const fromSlot = setting.slot ? slots[setting.slot]?.assetId : undefined;
  const id = fromSlot || setting.assetId;
  if (!id) return null;
  const asset = q.getAsset(id);
  if (!asset || asset.kind !== kind) throw new Error(`${label} asset ${id} is not ${kind === "audio" ? "an audio" : "an image"} asset in this project.`);
  return { src: asset.id };
}

/**
 * A sound: the slot the author filled, a literal asset, or a search run once and adopted
 * into the project the way a picture is.
 *
 * A search that finds nothing — or a machine with no network — leaves the template silent
 * there and cuts the video anyway. Sound is decoration; refusing to apply the template
 * over it would be the wrong trade.
 */
async function resolveSound(
  setting: { enabled: boolean; slot: string; assetId: string; starter: string; query: string },
  slots: Record<string, SlotValue>,
  label: string,
  projectId: string,
  kind: AudioKind,
  cache: Map<string, { src: string } | null>,
) {
  if (!setting.enabled) return null;
  const fromSlot = setting.slot ? slots[setting.slot]?.assetId : undefined;
  const id = fromSlot || setting.assetId;
  if (id) {
    const asset = q.getAsset(id);
    if (!asset || asset.kind !== "audio") throw new Error(`${label} asset ${id} is not an audio asset in this project.`);
    return { src: asset.id };
  }
  const starter = setting.starter.trim();
  if (starter) {
    const { installStarterSounds } = await import("../assets");
    // Idempotent, and it never resurrects one the owner deleted: that is a decision.
    await installStarterSounds();
    const found = q.listAssets("audio").find(a => a.source === "starter" && a.name.toLowerCase() === starter.toLowerCase());
    return found ? { src: found.id } : null;
  }
  const query = setting.query.trim();
  if (!query) return null;
  const key = `${kind}:${query.toLowerCase()}`;
  const known = cache.get(key);
  if (known !== undefined) return known;
  let found: { src: string } | null = null;
  try {
    for (const hit of await searchAudio(query, 5, kind)) {
      try { found = { src: (await adoptAudioHit(hit, projectId)).id }; break; }
      catch { /* try the next hit: a dead download is not a dead search */ }
    }
  } catch {
    // Offline, or the aggregator is down. Same outcome as no match.
  }
  cache.set(key, found);
  return found;
}

/**
 * An intro or outro is a picture held for `seconds`, or a library video played whole.
 * A video that is not yet project media is added as media in the same batch, so the
 * bookend is an ordinary shot backed by the library file.
 */
async function resolveBookend(
  setting: { enabled: boolean; slot: string; assetId: string; seconds: number; level: "match" | "as-is" },
  slots: Record<string, SlotValue>,
  label: string,
  media: MediaSource[],
  /** The video this bookend is stuck on, so the card can arrive at its loudness. */
  body?: { file: string; start: number; duration: number } | null,
): Promise<Bookend | null> {
  if (!setting.enabled) return null;
  const id = (setting.slot ? slots[setting.slot]?.assetId : undefined) || setting.assetId;
  if (!id) return null;
  const asset = q.getAsset(id);
  if (!asset) throw new Error(`${label} asset ${id} does not exist.`);
  if (asset.kind === "image") return { src: asset.id, seconds: setting.seconds };
  if (asset.kind !== "video") throw new Error(`${label} asset ${id} is a sound; use an image or a video.`);
  const { toAbs } = await import("../assets");
  const { probe, loudness } = await import("../media");
  const file = toAbs(asset.path);
  const known = media.find((m) => m.file === file);
  const source = known ?? MediaSource.parse({ id: `m_${randomUUID().replaceAll("-", "")}`, name: asset.name, file, ...(await probe(file)) });
  let gain: number | undefined;
  if (setting.level === "match" && body) {
    const [card, video] = await Promise.all([loudness(file), loudness(body.file, { start: body.start, duration: body.duration })]);
    // Either measurement failing means leaving the sound exactly as it was mixed,
    // which is what happened before anything measured it at all.
    if (card !== null && video !== null && Math.abs(video - card) > 1) {
      gain = Math.min(2, Math.max(0.2, 10 ** ((video - card) / 20)));
    }
  }
  return { media: source, addMedia: !known, seconds: source.durationSec, gain };
}

/** A beat the template wanted to illustrate and could not, with what each source said. */
export type DroppedBeat = {
  itemId: string;
  sentence: string;
  atSec: number;
  query: string;
  attempts: CueAttempt[];
};

export type TemplateApplyResult = {
  revision: number;
  plan: TemplatePlan;
  applied: {
    images: number;
    /** Beats that wanted a picture and got one. */
    placed: number;
    /** Beats left bare, and why. A template is tuned from this list. */
    dropped: DroppedBeat[];
    credits: string[];
  };
};

/**
 * How many pictures each slot supplies, without importing any of them. A folder is
 * *counted* rather than assumed full: reading a directory is free and changes nothing,
 * and guessing instead means the one shortfall a dry run can prove — more beats than
 * pictures — can never be proved on the input people actually give. The dry run, the
 * suggestion and the apply path all size pools through this one function.
 */
export async function countPools(slots: Record<string, SlotValue>): Promise<{ sizes: Record<string, number>; unreadable: string[] }> {
  const sizes: Record<string, number> = {};
  const unreadable: string[] = [];
  for (const [id, value] of Object.entries(slots)) {
    if (value.assetIds?.length) { sizes[id] = value.assetIds.length; continue; }
    if (!value.folder?.trim()) { sizes[id] = 0; continue; }
    const counted = await folderImages(value.folder).then((found) => found.files.length).catch(() => null);
    if (counted === null) unreadable.push(value.folder);
    sizes[id] = counted ?? 0;
  }
  return { sizes, unreadable };
}

/** Plan only: no network, no writes. Both interfaces show this before committing. */
/** The template as it applies to this video: overrides merged, then the aspect variant, look and brand resolved. */
async function templateFor(edl: ReturnType<typeof readEditor>["edl"], request: TemplateRequest): Promise<VideoTemplate> {
  const merged = mergeTemplate(await getTemplate(request.templateId), request.overrides);
  const { sequenceId, promotes } = resolveTarget(edl, request);
  const sequence = (promotes ? promoteClipToSequence(edl, sequenceId) : edl).sequences.find((s) => s.id === sequenceId)!;
  return resolveTemplate(merged, { aspect: aspectOf(merged.output ?? sequence.output) });
}

export async function previewTemplate(projectId: string, raw: unknown): Promise<TemplatePlan> {
  const request = TemplateRequest.parse(raw);
  const { edl } = readEditor(projectId);
  const template = await templateFor(edl, request);
  const { sizes, unreadable } = await countPools(request.slots);
  const plan = await planTemplate(edl, template, request, sizes);
  for (const folder of unreadable) plan.warnings.unshift(`${folder} could not be read, so it counts as no pictures.`);
  return plan;
}

export async function applyTemplate(
  projectId: string, raw: unknown, expectedRevision: number,
  /** `author` marks every edit; rules pass their own so "why is this here" can name them. */
  options: { author?: string } = {},
): Promise<TemplateApplyResult> {
  const request = TemplateRequest.parse(raw);
  const current = readEditor(projectId);
  if (current.revision !== expectedRevision) throw new RevisionConflict(current);
  const template = await templateFor(current.edl, request);

  // Plan on a count first, so a request that is going to be refused — an ambiguous
  // target, a missing required slot — is refused before a folder of two hundred
  // pictures has been copied into the project on its behalf.
  requireSlots(template, request.slots);
  const { sizes } = await countPools(request.slots);
  const plan = await planTemplate(current.edl, template, request, sizes);
  const pools = await buildPools(template, request.slots);

  // Resolution runs against the timeline the operations will produce, not the one on
  // disk. A generated clip promotes to a shot backed by the original source, and
  // reading it as a source-free item here would silently disable `frame` capture on
  // exactly the clips that have footage to capture from.
  const promoted = plan.promotes ? promoteClipToSequence(current.edl, plan.sequenceId) : current.edl;
  const sequenceItems = new Map(
    (promoted.sequences.find((s) => s.id === plan.sequenceId)?.items ?? []).map((item) => [item.id, item]),
  );

  const context: Context = {
    projectId, template, pools, providers: request.providers,
    projectImages: [...q.listAssets("image", projectId)],
    media: promoted.media,
    credits: new Map(),
    brandAssets: new Map(),
  };

  const resolved = new Map<string, ResolvedImage[]>();
  const dropped: DroppedBeat[] = [];
  for (const planned of plan.items) {
    const item = sequenceItems.get(planned.itemId);
    for (const [index, cue] of planned.cues.entries()) {
      let resolution: CueResolution = { images: [], attempts: [{ source: "(none)", outcome: "failed", detail: "this shot is no longer on the timeline" }] };
      if (item) {
        try { resolution = await resolveCue(context, item, cue); }
        catch (error) { resolution = { images: [], attempts: [{ source: "(all)", outcome: "failed", detail: (error as Error).message }] }; }
      }
      if (resolution.images.length) resolved.set(`${planned.itemId}:${index}`, resolution.images);
      else dropped.push({
        itemId: planned.itemId,
        sentence: planned.analyses[cue.sentenceIndex]?.sentence.text ?? "",
        atSec: cue.t,
        query: cue.query,
        attempts: resolution.attempts,
      });
    }
  }

  // One switch silences everything the template would place, without unpicking the rest of it.
  const silent = template.sound.mode === "off";
  const sounds = new Map<string, { src: string } | null>();
  const music = silent ? null : await resolveSound(template.music, request.slots, "Music", projectId, "music", sounds);
  const watermark = resolveSlotAsset(template.watermark, request.slots, "image", "Watermark");
  // The loudness of the video the bookends sit around: the first shot with footage in
  // it, which is what a viewer's ears have adjusted to by the time the card arrives.
  const bodyShot = [...sequenceItems.values()].find((item) => item.mediaId);
  const bodyMedia = bodyShot ? promoted.media.find((m) => m.id === bodyShot.mediaId) : undefined;
  const body = bodyShot && bodyMedia
    ? { file: bodyMedia.file, start: bodyShot.clip.start, duration: Math.max(1, bodyShot.clip.end - bodyShot.clip.start) }
    : null;
  const intro = await resolveBookend(template.intro, request.slots, "Intro", promoted.media, body);
  const outro = await resolveBookend(template.outro, request.slots, "Outro", promoted.media, body);
  const sound = silent ? {} : {
    punch: await resolveSound({ ...template.rhythm.punch.sfx, enabled: template.rhythm.punch.enabled && template.rhythm.punch.sfx.enabled }, request.slots, "Punch sound", projectId, "sfx", sounds),
    transitions: await resolveSound(template.sound.transitions, request.slots, "Transition sound", projectId, "sfx", sounds),
    opener: await resolveSound(template.sound.opener, request.slots, "Opening sound", projectId, "sfx", sounds),
  };
  const operations = templateOperations(current.edl, template, plan, resolved, (prefix) => `${prefix}_${randomUUID().slice(0, 8)}`, music, watermark, options.author, { intro, outro }, sound);
  if (!operations.length) throw new Error("This template would not change anything on this video.");
  const saved = editProject(projectId, { expectedRevision, operations });
  return {
    revision: saved.revision,
    plan,
    applied: {
      images: [...resolved.values()].reduce((total, images) => total + images.length, 0),
      placed: resolved.size,
      dropped,
      credits: [...new Set(context.credits.values())],
    },
  };
}

