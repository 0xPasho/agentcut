import type { VideoTemplate } from "./schema";
import { VideoTemplate as VideoTemplateSchema } from "./schema";
import { CAPTION_LOOKS } from "./looks";

/**
 * A template as it will actually be applied to one video: the aspect variant merged
 * in, the caption look and brand kit folded under the template's own caption fields,
 * the brand logo lent to the watermark. Pure, and the last word before planning.
 */
const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
export function deepMerge(base: unknown, patch: unknown): unknown {
  if (!isPlainObject(patch)) return patch;
  const target: Record<string, unknown> = isPlainObject(base) ? { ...base } : {};
  for (const [key, value] of Object.entries(patch)) target[key] = deepMerge(target[key], value);
  return target;
}

/** "9:16", "1:1", "16:9", "4:5" or the nearest of them. */
export function aspectOf(output: { width: number; height: number }): string {
  const ratio = output.width / output.height;
  const known: Array<[string, number]> = [["9:16", 9 / 16], ["4:5", 4 / 5], ["1:1", 1], ["16:9", 16 / 9]];
  return known.reduce((best, entry) => Math.abs(entry[1] - ratio) < Math.abs(best[1] - ratio) ? entry : best)[0];
}

export function resolveTemplate(template: VideoTemplate, target: { aspect?: string } = {}): VideoTemplate {
  let working: VideoTemplate = structuredClone(template);
  const variant = target.aspect ? working.variants[target.aspect] : undefined;
  if (variant) {
    const { id, schema, extends: _e, variants, ...patch } = variant as Record<string, unknown>; void id; void schema; void _e; void variants;
    working = VideoTemplateSchema.parse(deepMerge(working, patch));
  }
  const look = working.captionLook ? CAPTION_LOOKS[working.captionLook]?.style : undefined;
  if (working.captionLook && !look) throw new Error(`Unknown caption look: ${working.captionLook}. Known: ${Object.keys(CAPTION_LOOKS).join(", ")}`);
  const brand = working.brand;
  const fromBrand: Record<string, unknown> = {};
  if (brand.palette.primary) fromBrand.highlight = brand.palette.primary;
  if (brand.palette.text) fromBrand.color = brand.palette.text;
  if (brand.fonts.captions) fromBrand.fontFamily = brand.fonts.captions;
  working.captions = { ...(look ?? {}), ...fromBrand, ...working.captions } as VideoTemplate["captions"];
  if (working.watermark.enabled && !working.watermark.slot && !working.watermark.assetId) {
    if (brand.logo.assetId) working.watermark.assetId = brand.logo.assetId;
    else if (brand.logo.slot) working.watermark.slot = brand.logo.slot;
  }
  return working;
}
