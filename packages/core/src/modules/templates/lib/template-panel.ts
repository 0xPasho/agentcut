import type { VideoTemplate } from "../types";
import type { Overrides } from "../types";

export const labelled = (labels: Record<string, string>, fallback: string) =>
  (value: unknown) => labels[String(value)] ?? fallback;

export const asNumber = (v: number | readonly number[]) => (Array.isArray(v) ? v[0] : (v as number));

export const overridesFrom = (template: VideoTemplate): Overrides => ({
  ...(template.captionLook ? { captionLook: template.captionLook } : {}),
  layout: {
    mode: template.layout.mode, cameraPct: template.layout.cameraPct, cameraPosition: template.layout.cameraPosition,
    camera: { ...template.layout.camera }, screen: { ...template.layout.screen },
  },
  hook: { mode: template.hook.mode },
  images: {
    mode: template.images.mode, density: template.images.density, minSentenceGap: template.images.minSentenceGap,
    durationSec: template.images.durationSec, widthPct: template.images.widthPct,
    logoWidthPct: template.images.logoWidthPct, style: template.images.style,
    // A source list is compared and edited as a set of kinds; a `web:pexels` entry keeps its provider.
    sources: template.images.sources,
  },
  rhythm: {
    silence: { enabled: template.rhythm.silence.enabled },
    punch: { enabled: template.rhythm.punch.enabled, perMinute: template.rhythm.punch.perMinute },
  },
});
