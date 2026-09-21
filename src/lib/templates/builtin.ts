import { VideoTemplate } from "./schema";

const VERTICAL = { width: 1080, height: 1920, fps: 30 };

/**
 * The templates the product ships with. They are ordinary template documents —
 * nothing here is reachable only from code — so a user template can copy one,
 * change three fields and behave identically.
 */
const DEFINITIONS: unknown[] = [
  {
    id: "explainer-broll",
    name: "Explainer with b-roll",
    description:
      "Vertical explainer: a hook that stays on screen, karaoke captions, and a picture on the sentences that name something. Roughly every other sentence gets one — never two in a row.",
    tags: ["vertical", "explainer", "b-roll", "captions"],
    output: VERTICAL,
    captions: { preset: "karaoke", positionY: 0.7, fontSizePct: 5.6, maxWordsPerLine: 3, uppercase: true, highlight: "#ffe600" },
    hook: { mode: "sticky", position: "top", style: "card", maxWords: 9 },
    images: {
      mode: "auto", density: 0.45, minSentenceGap: 1, minGapSec: 2.5, durationSec: 2.6,
      minSalience: 0.45, y: 0.32, widthPct: 76, style: "auto", maxCount: 24,
      sources: ["slot", "brand", "project", "web"],
    },
    rhythm: {
      silence: { enabled: true, minGapSec: 0.45, keepSec: 0.12 },
      punch: { enabled: true, perMinute: 4, scale: 1.12 },
      emphasis: { enabled: true, targets: ["numbers", "brands"] },
    },
    watermark: { enabled: true, slot: "logo", corner: "bottom-right", widthPct: 12, opacity: 0.9 },
    music: { enabled: true, slot: "music", gain: 0.2, duck: true, loop: true },
    slots: [
      { id: "logo", label: "Your logo", kind: "image",
        description: "Optional. Held in a corner for the whole video." },
      { id: "screenshots", label: "Screenshots folder", kind: "imagePool",
        description: "Optional. Pictures used in order before anything is searched for — chat screenshots, receipts, charts." },
      { id: "music", label: "Music bed", kind: "audio", description: "Optional. Ducked under the voice automatically." },
    ],
  },
  {
    id: "talking-head",
    name: "Talking head, clean",
    description: "Captions, dead-air cuts and occasional punch-ins. No pictures — for a clip where the speaker is the whole point.",
    tags: ["vertical", "captions", "minimal"],
    output: VERTICAL,
    captions: { preset: "karaoke", positionY: 0.74, fontSizePct: 5.2, maxWordsPerLine: 3 },
    hook: { mode: "intro", seconds: 2.5, position: "top", style: "card", maxWords: 8 },
    images: { mode: "off" },
    rhythm: {
      silence: { enabled: true, minGapSec: 0.4, keepSec: 0.12 },
      punch: { enabled: true, perMinute: 3, scale: 1.1 },
      emphasis: { enabled: true, targets: ["numbers"] },
    },
  },
  {
    id: "brand-explainer",
    name: "Brand explainer",
    description:
      "Every company or product named gets its own mark on a white plate, two side by side when a sentence names two. Built for comparisons and industry commentary.",
    tags: ["vertical", "logos", "brands", "comparison"],
    output: VERTICAL,
    captions: { preset: "karaoke", positionY: 0.72, fontSizePct: 5.4, maxWordsPerLine: 3, uppercase: true },
    hook: { mode: "sticky", position: "top", style: "card", maxWords: 9 },
    images: {
      mode: "auto", density: 0.6, minSentenceGap: 1, minGapSec: 2, durationSec: 2.4,
      minSalience: 0.5, y: 0.3, widthPct: 44, logoWidthPct: 44, style: "logo", caption: "subject",
      sources: ["brand", "project", "web"], pairBrands: true, maxCount: 30,
    },
    rhythm: {
      silence: { enabled: true },
      punch: { enabled: true, perMinute: 3 },
      emphasis: { enabled: true, targets: ["brands", "numbers"] },
    },
    watermark: { enabled: true, slot: "logo", corner: "bottom-right", widthPct: 12, opacity: 0.9 },
    slots: [
      { id: "logo", label: "Your logo", kind: "image",
        description: "Optional. Held in a corner for the whole video." },
    ],
  },
  {
    id: "chat-story",
    name: "Chat screenshots",
    description:
      "Tells the story over a folder of screenshots, shown in the order they appear in the folder, one every couple of sentences. Drop the folder in before applying.",
    tags: ["vertical", "screenshots", "story"],
    output: VERTICAL,
    // A plate rather than an outline: these captions sit under a screenshot, not over footage.
    captions: { preset: "boxed", positionY: 0.78, fontSizePct: 4.8, maxWordsPerLine: 4 },
    hook: { mode: "sticky", position: "top", style: "card", maxWords: 10 },
    images: {
      mode: "alternate", minSentenceGap: 1, minGapSec: 2.2, durationSec: 3,
      // A chat crop is portrait. In a portrait frame it has to be bounded by height,
      // and centred between the hook above it and the captions below it.
      y: 0.46, widthPct: 86, heightPct: 56, style: "plain", sources: ["slot:screenshots"], maxCount: 40,
    },
    rhythm: {
      silence: { enabled: true },
      punch: { enabled: false },
      emphasis: { enabled: true, targets: ["numbers"] },
    },
    music: { enabled: true, slot: "music", gain: 0.2, duck: true, loop: true },
    slots: [
      { id: "screenshots", label: "Screenshots folder", kind: "imagePool", required: true,
        description: "A folder of images on this machine. They are used in filename order, one per beat." },
      { id: "music", label: "Music bed", kind: "audio", description: "Optional. Ducked under the voice automatically." },
    ],
  },
  {
    id: "story-arc",
    name: "Story with a turn",
    description:
      "Gives a story a shape: the hook holds, a card marks the turn about halfway through, and a closing line lands at the end. Write those two lines when you apply it; leave one empty and its card is simply not there.",
    tags: ["vertical", "story", "structure"],
    output: VERTICAL,
    captions: { preset: "karaoke", positionY: 0.74, fontSizePct: 5.2, maxWordsPerLine: 3 },
    hook: { mode: "sticky", position: "top", style: "card", maxWords: 8 },
    images: {
      mode: "auto", density: 0.4, minSentenceGap: 1, minGapSec: 3, durationSec: 2.6,
      minSalience: 0.45, y: 0.34, widthPct: 74, style: "auto", maxCount: 16,
      sources: ["slot", "brand", "project", "web"],
    },
    rhythm: {
      silence: { enabled: true },
      punch: { enabled: true, perMinute: 3 },
      emphasis: { enabled: true, targets: ["numbers", "brands"] },
    },
    cards: [
      { id: "turn", atFraction: 0.45, text: "{{slot:turn}}", seconds: 1.8, position: "center", style: "card" },
      // Not "bottom": that is where the captions are, and a card there hides the line
      // being spoken underneath it.
      { id: "cta", atFraction: 1, text: "{{slot:cta}}", seconds: 2.2, position: "center", style: "card" },
    ],
    music: { enabled: true, slot: "music", gain: 0.2, duck: true, loop: true },
    slots: [
      { id: "music", label: "Music bed", kind: "audio", description: "Optional. Ducked under the voice automatically." },
      { id: "turn", label: "Mid-point line", kind: "text",
        description: "Optional. The card that marks the turn — \"but here is what actually happened\"." },
      { id: "cta", label: "Closing line", kind: "text",
        description: "Optional. The last thing on screen: an ask, a promise, a handle." },
      { id: "screenshots", label: "Screenshots folder", kind: "imagePool",
        description: "Optional. Pictures used in order before anything is searched for." },
    ],
  },
  {
    id: "product-demo",
    name: "Product demo",
    description:
      "Illustrates from the footage itself: a still is captured from the shot at the moment something is described, so the picture always matches what is on screen.",
    tags: ["vertical", "demo", "frames"],
    output: VERTICAL,
    captions: { preset: "karaoke", positionY: 0.76, fontSizePct: 5, maxWordsPerLine: 3 },
    hook: { mode: "intro", seconds: 3, position: "top", style: "card", maxWords: 9 },
    images: {
      mode: "auto", density: 0.35, minSentenceGap: 2, minGapSec: 4, durationSec: 2.4,
      minSalience: 0.5, y: 0.28, widthPct: 70, style: "card",
      sources: ["frame", "project", "brand"], maxCount: 12,
    },
    rhythm: {
      silence: { enabled: true },
      punch: { enabled: true, perMinute: 2 },
      emphasis: { enabled: true, targets: ["numbers", "entities"] },
    },
  },
];

export const BUILTIN_TEMPLATES: VideoTemplate[] = DEFINITIONS.map((definition) => VideoTemplate.parse(definition));
