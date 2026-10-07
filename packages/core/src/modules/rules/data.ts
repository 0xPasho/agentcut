import type { Rule } from "./types";

export const KIND_LABEL: Record<string, string> = { image: "picture", video: "video", audio: "sound" };

export const EMPTY_RULE: Rule = { id: "", name: "", description: "", when: "", stage: "both", priority: 100, enabled: true, then: {} };

export const STAGE_LABELS: Record<string, string> = { select: "Choosing clips", edit: "Editing", both: "Both" };

export const RULE_EXAMPLES = [
  "For gameplay clips, keep the game visible without added pictures.",
  "End every stream clip with my outro video.",
  "When choosing clips, skip sponsorship segments.",
];

export const SETTING_LABELS: Record<string, string> = {
  images: "Supporting images", captions: "Subtitles", captionLook: "Subtitle look", hook: "Opening title",
  comment: "Viewer comment", rhythm: "Pacing", music: "Background music", sound: "Sound effects", audio: "Audio loudness",
  intro: "Opening", outro: "Ending", layout: "Framing", brand: "Brand", watermark: "Watermark", cards: "Cards",
  output: "Video format", variants: "Settings by aspect ratio", selection: "Clip selection", slots: "Template inputs",
  pop: "Pop over the video", open: "Open on the comment", none: "None", on: "On", karaoke: "Highlight each spoken word", popline: "One line at a time", boxed: "Boxed subtitles", every: "Every sentence", alternate: "Every other sentence", mode: "Mode", enabled: "Enabled", off: "Off", auto: "Automatic", sticky: "Throughout the video", source: "Keep source framing",
  crop: "Crop to fill", split: "Screen and camera", density: "Share of sentences with images (0–1)",
  durationSec: "Duration (seconds)", seconds: "Duration (seconds)", widthPct: "Width (%)", logoWidthPct: "Logo width (%)",
  minSentenceGap: "Sentences between images", targetLufs: "Target loudness (LUFS)", prompt: "Agent instruction",
  silence: "Silence removal", punch: "Punch-in zoom", followReading: "Follow the spoken comment", gain: "Volume multiplier",
  maxSeconds: "Maximum duration (seconds)", latestSec: "Latest start (seconds)", delaySec: "Delay (seconds)",
  cameraPct: "Camera height (%)", cameraPosition: "Camera position", assetId: "Library file", text: "Text",
};

export const COMMON_RULE_SETTINGS = [
  { path: ["captions", "preset"], label: "Subtitles" },
  { path: ["sound", "mode"], label: "Added music and sound effects" },
  { path: ["images", "mode"], label: "Supporting images" },
  { path: ["hook", "mode"], label: "Opening title" },
  { path: ["comment", "enabled"], label: "Show the viewer comment" },
  { path: ["rhythm", "silence", "enabled"], label: "Remove silence" },
  { path: ["rhythm", "punch", "enabled"], label: "Punch-in zoom" },
] as const;
