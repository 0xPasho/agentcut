import { VideoTemplate } from "../types";

const VERTICAL = { width: 1080, height: 1920, fps: 30 };
const HORIZONTAL = { width: 1920, height: 1080, fps: 30 };

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
  {
    id: "fast-cuts",
    name: "Fast cuts",
    description:
      "Short-form at speed: every pause cut out, a punch-in every few seconds with a whoosh on it, a swipe on each cut and a riser on the first frame. For a clip that has to survive the first second.",
    tags: ["vertical", "fast", "sound", "captions"],
    output: VERTICAL,
    captions: { preset: "popline", positionY: 0.68, fontSizePct: 6.4, maxWordsPerLine: 2, uppercase: true, highlight: "#ffe600" },
    hook: { mode: "sticky", position: "top", style: "card", maxWords: 7, uppercase: true },
    images: {
      mode: "auto", density: 0.5, minSentenceGap: 1, minGapSec: 2, durationSec: 2,
      minSalience: 0.45, y: 0.3, widthPct: 74, style: "auto", maxCount: 28,
      sources: ["slot", "brand", "project", "web"],
    },
    rhythm: {
      // Tighter than the other templates on purpose: this is the one that should feel edited.
      silence: { enabled: true, minGapSec: 0.3, keepSec: 0.08 },
      punch: { enabled: true, perMinute: 8, scale: 1.16, durationSec: 0.9,
        sfx: { enabled: true, starter: "whoosh", gain: 0.45, durationSec: 0.6 } },
      emphasis: { enabled: true, targets: ["numbers", "brands"] },
    },
    sound: {
      transitions: { enabled: true, starter: "swipe", gain: 0.4, durationSec: 0.5 },
      opener: { enabled: true, starter: "riser", gain: 0.55, durationSec: 1.4 },
    },
    watermark: { enabled: true, slot: "logo", corner: "bottom-right", widthPct: 12, opacity: 0.9 },
    music: { enabled: true, slot: "music", gain: 0.18, duck: true, loop: true },
    slots: [
      { id: "logo", label: "Your logo", kind: "image", description: "Optional. Held in a corner for the whole video." },
      { id: "screenshots", label: "Screenshots folder", kind: "imagePool",
        description: "Optional. Pictures used in order before anything is searched for." },
      { id: "music", label: "Music bed", kind: "audio", description: "Optional. Ducked under the voice automatically." },
    ],
  },
  {
    id: "quote-card",
    name: "Quote",
    description:
      "One thing said well: the words sit in the middle of the frame on a plate, nothing moves, nothing illustrates, and a ding opens it. For a line that does not need help.",
    tags: ["vertical", "quote", "minimal", "captions"],
    output: VERTICAL,
    // Centred rather than down at caption height: with no hook and no pictures, the words
    // are the composition.
    captions: { preset: "boxed", positionY: 0.4, fontSizePct: 6, maxWordsPerLine: 4 },
    hook: { mode: "off" },
    images: { mode: "off" },
    rhythm: {
      silence: { enabled: true, minGapSec: 0.5, keepSec: 0.15 },
      punch: { enabled: false },
      emphasis: { enabled: false },
    },
    sound: { opener: { enabled: true, starter: "ding", gain: 0.45, durationSec: 1.4 } },
    music: { enabled: true, slot: "music", gain: 0.16, duck: true, loop: true },
    slots: [
      { id: "music", label: "Music bed", kind: "audio", description: "Optional. Ducked under the voice automatically." },
    ],
  },
  {
    id: "how-to-steps",
    name: "How-to, step by step",
    description:
      "Each step gets a push in and a ding, illustrated from the footage itself so the picture always matches what is on screen, and a recap card at the end if you write one.",
    tags: ["vertical", "tutorial", "frames", "sound"],
    output: VERTICAL,
    captions: { preset: "karaoke", positionY: 0.76, fontSizePct: 5, maxWordsPerLine: 3 },
    hook: { mode: "sticky", position: "top", style: "card", maxWords: 9 },
    images: {
      mode: "auto", density: 0.4, minSentenceGap: 1, minGapSec: 3, durationSec: 2.4,
      minSalience: 0.45, y: 0.3, widthPct: 72, style: "card",
      // A real screenshot beats a frame grab, so a supplied folder is used first; with
      // no folder, a still from the footage answers instead.
      sources: ["slot", "frame", "project"], maxCount: 16,
    },
    rhythm: {
      silence: { enabled: true },
      // A step is a beat: the sound is what makes it read as one.
      punch: { enabled: true, perMinute: 5, scale: 1.1, durationSec: 1,
        sfx: { enabled: true, starter: "ding", gain: 0.35, durationSec: 0.9 } },
      emphasis: { enabled: true, targets: ["numbers", "entities"] },
    },
    cards: [
      { id: "recap", atFraction: 1, text: "{{slot:recap}}", seconds: 2.4, position: "center", style: "card" },
    ],
    slots: [
      { id: "recap", label: "Closing line", kind: "text",
        description: "Optional. The last thing on screen — what they now know how to do." },
      { id: "screenshots", label: "Screenshots folder", kind: "imagePool",
        description: "Optional. Used before a still is captured from the footage." },
    ],
  },
  {
    id: "news-brief",
    name: "News brief",
    description:
      "Commentary on what happened: every company named gets its mark, numbers are lit, an impact lands on each cut and a riser opens it. Captions sit low so the plate has the frame.",
    tags: ["vertical", "news", "logos", "sound"],
    output: VERTICAL,
    captions: { preset: "boxed", positionY: 0.8, fontSizePct: 4.8, maxWordsPerLine: 4, uppercase: true },
    hook: { mode: "sticky", position: "top", style: "card", maxWords: 10, uppercase: true },
    images: {
      mode: "auto", density: 0.55, minSentenceGap: 1, minGapSec: 2.2, durationSec: 2.4,
      minSalience: 0.5, y: 0.34, widthPct: 46, logoWidthPct: 46, style: "logo", caption: "subject",
      sources: ["brand", "project", "web"], pairBrands: true, maxCount: 28,
    },
    rhythm: {
      silence: { enabled: true },
      punch: { enabled: true, perMinute: 3, scale: 1.08 },
      emphasis: { enabled: true, targets: ["numbers", "brands"] },
    },
    sound: {
      transitions: { enabled: true, starter: "impact", gain: 0.4, durationSec: 0.8 },
      opener: { enabled: true, starter: "riser", gain: 0.5, durationSec: 1.4 },
    },
    watermark: { enabled: true, slot: "logo", corner: "bottom-right", widthPct: 12, opacity: 0.9 },
    slots: [
      { id: "logo", label: "Your logo", kind: "image", description: "Optional. Held in a corner for the whole video." },
    ],
  },
  {
    id: "stream-short",
    name: "Stream short — screen and camera",
    description:
      "A vertical short cut from a screen-share stream: the screen on top, you underneath, the hook held for the whole video and the sentence being said above the seam, its spoken word lit. Set the two rectangles to match your own scene, and give it the card you end every video on.",
    tags: ["vertical", "stream", "split", "captions", "screen-share"],
    output: VERTICAL,
    captionLook: "stream-karaoke",
    // Two rows of the phrase end just above the seam at 0.68.
    captions: { positionY: 0.545 },
    hook: { mode: "sticky", position: "top", style: "card", maxWords: 10 },
    // The screen is the b-roll. A picture over it would cover the thing being talked about.
    images: { mode: "off" },
    layout: {
      mode: "split", cameraPosition: "bottom", cameraPct: 32,
      // The screen stops where the camera starts, so the person is not on screen twice.
      screen: { x: 0, y: 0, w: 0.68, h: 1 },
      // Where a webcam sits in most scenes, and the one setting worth checking against
      // your own before the first render: nothing can read it off a document.
      camera: { x: 0.68, y: 0.72, w: 0.32, h: 0.28 },
    },
    rhythm: {
      // A stream is mostly pauses and false starts, and the first pass at this cut the
      // breathing with them: at 0.35s no pause over a third of a second survived at all,
      // where the shorts this shape was measured from keep one every three seconds. So
      // dead air here means a second of it, and a second of it becomes a beat rather
      // than a join. See `pace.ts` and `scripts/pace.ts` for how that was measured.
      silence: { enabled: true, minGapSec: 1, keepSec: 0.3, maxGapSec: 30 },
      redundancy: { enabled: true, minWords: 2, maxGapSec: 1.5 },
      punch: { enabled: true, perMinute: 3, scale: 1.1 },
      emphasis: { enabled: true, targets: ["numbers", "brands"] },
    },
    // A shorter frame needs a taller share for the person, or the camera's own shape is
    // cropped to a letterbox: a webcam is about as wide as it is tall and a half of a
    // square frame at a third of the height is three times wider than it is tall.
    variants: {
      // Moving the seam moves where the captions have to sit: they belong just above it,
      // on the screen's half, and a variant that only changed the share left them over
      // the speaker's face.
      "1:1": { layout: { cameraPct: 55 }, captions: { positionY: 0.32 } },
      "4:5": { layout: { cameraPct: 44 }, captions: { positionY: 0.43 } },
      "16:9": { layout: { mode: "crop" }, captions: { positionY: 0.72 } },
    },
    // A stream is recorded for a stream, not for a feed: measured on two of them, the
    // speech sits around -23 LUFS, where a phone's feed normalises everything to about
    // -14 and the channel's own published shorts sit at -18. This puts it between them,
    // as far as the footage's own peaks allow.
    audio: { targetLufs: -16 },
    outro: { enabled: true, slot: "endcard" },
    slots: [
      { id: "endcard", label: "Your end card", kind: "video",
        description: "Optional. The clip you end every video on — the schedule card, the subscribe sting. Played whole after the last word." },
      { id: "music", label: "Music bed", kind: "audio", description: "Optional. Ducked under the voice automatically." },
    ],
  },
  {
    id: "music-montage",
    name: "Montage, no talking",
    description:
      "For footage with nobody speaking: no captions, no cuts made for you, a bed under the whole thing and a whoosh on every cut between shots. The one template that needs no transcript.",
    tags: ["vertical", "montage", "music", "silent"],
    output: VERTICAL,
    captions: { preset: "none" },
    hook: { mode: "off" },
    images: { mode: "off" },
    rhythm: {
      // There is no speech to find dead air in, and a push-in on a shot nobody is
      // narrating is just a wobble.
      silence: { enabled: false },
      punch: { enabled: false },
      emphasis: { enabled: false },
    },
    sound: { transitions: { enabled: true, starter: "whoosh", gain: 0.45, durationSec: 0.7 } },
    music: { enabled: true, slot: "music", gain: 0.5, duck: false, loop: true },
    slots: [
      { id: "music", label: "Music bed", kind: "audio", required: true,
        description: "The whole point: it plays across every cut. Not ducked — nobody is talking." },
    ],
  },
  /**
   * The long ones. Everything above dresses a moment somebody else found; these two say
   * what to find — `selection.mode: "section"` — which is the only reason a five-hour
   * stream can come out as one video instead of a pack of shorts. They are ordinary
   * template documents, so "a two-hour video, but with my captions" is a copy of one
   * with two fields changed, not a code change.
   */
  {
    id: "stream-to-youtube",
    name: "Stream to YouTube",
    description:
      "One long horizontal video out of a stream: the part of the session that is about one thing, kept in order, with the setup, the waiting and the breaks dropped. Chapters from what each stretch is about, dead air trimmed, loudness set for the platform.",
    tags: ["horizontal", "long-form", "youtube", "stream", "section"],
    output: HORIZONTAL,
    selection: {
      mode: "section",
      count: 1,
      // Twenty minutes is the floor at which this is a video rather than a long clip;
      // two and a half hours is the ceiling past which nobody finishes it.
      minSec: 1200,
      maxSec: 9000,
      targetSec: null,
      // One sitting. Above three hours of source the video stops being about one thing.
      sourceSpanSec: 10800,
      minSegmentSec: 45,
      chapters: true,
      brief:
        "A video for the people who came for this subject. Find the stretch of the session where it is actually being worked on or explained, open where the promise is stated, and keep the order it happened in. Drop the setup, the waiting, the tangents and the breaks whole.",
    },
    // A long video is read, not skimmed: burned captions across two hours are noise,
    // and the platform draws its own. A channel that wants them copies this and says so.
    captions: { preset: "none" },
    hook: { mode: "off" },
    comment: { enabled: false },
    images: { mode: "off" },
    rhythm: {
      // The one pass that always earns its place at this length: an hour of a stream is
      // a few minutes of silence. Gentler than a short, and a long gap is left alone —
      // at this length a pause is usually a scene, not dead air.
      silence: { enabled: true, minGapSec: 0.7, keepSec: 0.18, maxGapSec: 3 },
      redundancy: { enabled: true, maxGapSec: 1.5, minWords: 2 },
      // A push-in every fifteen seconds for two hours is motion sickness.
      punch: { enabled: false },
      emphasis: { enabled: false },
    },
    music: { enabled: false },
    sound: { mode: "off" },
    // The feed normalises to about -14 LUFS, and a stream recorded at -23 arrives
    // quiet under everything published beside it.
    audio: { targetLufs: -14 },
    intro: { enabled: false, slot: "intro", seconds: 5, level: "match" },
    outro: { enabled: false, slot: "outro", seconds: 8, level: "match" },
    slots: [
      { id: "intro", label: "Your intro", kind: "video",
        description: "Optional. Played whole before the video starts. Enable `intro` to use it." },
      { id: "outro", label: "Your end card", kind: "video",
        description: "Optional. Played whole at the end. Enable `outro` to use it." },
      { id: "logo", label: "Your logo", kind: "image",
        description: "Optional. Held in a corner for the whole video if `watermark` is enabled." },
    ],
  },
  {
    id: "stream-recap",
    name: "Stream recap",
    description:
      "The twenty-minute version of a long session: the same section edit, cut much tighter, so a stream nobody watched live is still worth an evening. Chapters, captions on, and a push-in on the lines that land.",
    tags: ["horizontal", "long-form", "recap", "stream", "section"],
    extends: "stream-to-youtube",
    selection: {
      minSec: 600,
      maxSec: 2400,
      targetSec: 1200,
      // A recap may range over the whole session — that is what makes it a recap.
      sourceSpanSec: null,
      minSegmentSec: 25,
      brief:
        "A recap: the moments that made the session worth watching, in the order they happened, with enough around each one that it makes sense. Not a highlight reel of reactions — every stretch has to say something.",
    },
    captions: { preset: "boxed", positionY: 0.82, fontSizePct: 3.4, maxWordsPerLine: 8, uppercase: false },
    rhythm: {
      silence: { enabled: true, minGapSec: 0.5, keepSec: 0.12, maxGapSec: 2.5 },
      punch: { enabled: true, perMinute: 1, scale: 1.06, durationSec: 1.4 },
      emphasis: { enabled: true, targets: ["numbers", "brands"] },
    },
  },
  /**
   * The news take. Not a stream and not a short: one person, one sitting, a screen full
   * of the thing they are talking about, recorded straight through and published the
   * same day. The whole difference between the recording and the video is what comes
   * *out* of it — the stalls, the sentence started twice, the tangent that went nowhere
   * — which is why this is the only built-in that turns on every cleanup pass at once.
   *
   * The numbers are measured, not chosen. A published 27-minute news video from the
   * channel this is modelled on (measured with `pnpm exec tsx scripts/pace.ts`) reads
   * at a median gap of 0.12s, p90 0.48s, p95 0.64s, and 24 pauses over a third of a
   * second per minute: fast, but with room in it. Its stalls are gone — "uh" survives
   * 0.04 times a minute — and so are its false starts, at 0.05 two-word repeats a
   * minute, while "like" and "so" survive 1.3-1.8 times a minute each, because that is
   * how the person talks. Cut the hesitation, keep the voice.
   */
  {
    id: "news-desk",
    name: "News desk",
    description:
      "One take about one story, tightened: the stalls, the false starts, the sentence said twice and the tangents that went nowhere all come out, and what is left is the argument in the order it was made. Horizontal, no burned captions, levelled for the feed.",
    tags: ["horizontal", "long-form", "news", "talking-head", "section"],
    output: HORIZONTAL,
    selection: {
      mode: "section",
      count: 1,
      // Under five minutes this is a short with a long name; past fifty, a story has
      // stopped being one story.
      minSec: 300,
      maxSec: 3000,
      targetSec: null,
      // A news take is already one sitting: there is no "which part of the day" to
      // decide, only which parts of it are the video.
      sourceSpanSec: null,
      // Small, because what is dropped here is a tangent or a lost thread, not an hour
      // of setup. Below fifteen seconds a drop is the cleanup passes' job, not a cut.
      minSegmentSec: 15,
      chapters: true,
      brief:
        "One person covering one story, recorded in one take. Keep the order it was said in — the claim, the evidence, the verdict — and keep the parts where something is actually being shown or argued. Drop what went nowhere: the tangent they abandon, the tab they cannot find, the point they lose and pick up again a minute later, the setup before the video really starts. Do not cut across a sentence, and do not cut inside a clip they are playing: the reaction only makes sense on top of it.",
    },
    // The platform draws its own captions on a horizontal video, and burning a second
    // set over a screen share covers the thing being talked about.
    captions: { preset: "none" },
    hook: { mode: "off" },
    comment: { enabled: false },
    // The screen is already the picture. A stock photograph over a screenshot of the
    // article is not illustration, it is cover.
    images: { mode: "off" },
    rhythm: {
      // Keeps every pause under 0.6s — which is where the published distribution sits —
      // and takes out everything above it, however long: a minute of reading in silence
      // is dead air, not a scene. The sound decides each one, so a word the recogniser
      // missed is never cut out with the quiet around it.
      silence: { enabled: true, minGapSec: 0.6, keepSec: 0.15, maxGapSec: 30 },
      redundancy: { enabled: true, minWords: 2, maxGapSec: 1.5 },
      filler: { enabled: true },
      retake: { enabled: true },
      // Zooming every fifteen seconds for half an hour is a tic. What movement this
      // kind of video has comes from the screen, not from the frame.
      punch: { enabled: false },
      emphasis: { enabled: false },
    },
    music: { enabled: false },
    sound: { mode: "off" },
    // The feed normalises to about -14 LUFS; a take recorded at -23 arrives quiet.
    audio: { targetLufs: -14 },
    intro: { enabled: false, slot: "intro", seconds: 5, level: "match" },
    outro: { enabled: false, slot: "outro", seconds: 8, level: "match" },
    slots: [
      { id: "intro", label: "Your intro", kind: "video",
        description: "Optional. Played whole before the video starts. Enable `intro` to use it." },
      { id: "outro", label: "Your end card", kind: "video",
        description: "Optional. Played whole at the end. Enable `outro` to use it." },
      { id: "logo", label: "Your logo", kind: "image",
        description: "Optional. Held in a corner for the whole video if `watermark` is enabled." },
    ],
  },
];

/**
 * `extends` between two built-ins is resolved here, the same way the registry resolves
 * it for a template on disk: a document that says "the long-form one, but twenty minutes
 * and with captions" is that parent with those fields changed. Without this a built-in
 * could only ever be written out in full, which is how a set of templates drifts.
 */
const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const deepMerge = (base: unknown, patch: unknown): unknown => {
  if (!isPlainObject(patch)) return patch;
  const target: Record<string, unknown> = isPlainObject(base) ? { ...base } : {};
  for (const [key, value] of Object.entries(patch)) target[key] = deepMerge(target[key], value);
  return target;
};

const byId = new Map(DEFINITIONS.map((definition) => [String((definition as Record<string, unknown>).id), definition as Record<string, unknown>]));
function flatten(raw: Record<string, unknown>, chain: string[]): Record<string, unknown> {
  const parentId = typeof raw.extends === "string" ? raw.extends : null;
  if (!parentId) return raw;
  if (chain.includes(parentId)) throw new Error(`Built-in template ${chain[0]} extends itself through ${[...chain, parentId].join(" → ")}`);
  const parent = byId.get(parentId);
  if (!parent) throw new Error(`Built-in template ${raw.id} extends ${parentId}, which does not exist`);
  return deepMerge(flatten(parent, [...chain, parentId]), raw) as Record<string, unknown>;
}

export const BUILTIN_TEMPLATES: VideoTemplate[] = DEFINITIONS.map((definition) =>
  VideoTemplate.parse(flatten(definition as Record<string, unknown>, [String((definition as Record<string, unknown>).id)])));
