import type { CaptionStyle } from "../edl";

/**
 * Named caption looks: a handful of ways captions can read, chosen by name from a
 * template (`captionLook`) or an override. A look is a partial caption style;
 * anything the template sets explicitly wins over it, and the brand kit's colours
 * win over the look's. Presets (`karaoke`, `popline`, `boxed`) are the renderer's
 * animation styles; a look is the typography and colour on top of one.
 */
export const CAPTION_LOOKS: Record<string, { label: string; description: string; style: Partial<CaptionStyle> }> = {
  "bold-yellow": { label: "Bold yellow", description: "Heavy uppercase words, yellow highlight, three per line. The short-form default.",
    style: { preset: "karaoke", fontFamily: "Inter", fontWeight: 900, fontSizePct: 5.8, color: "#ffffff", highlight: "#ffe600", strokeWidth: 8, maxWordsPerLine: 3, uppercase: true } },
  "clean-white": { label: "Clean white", description: "Regular case, white with a thin stroke, four words per line. For explainers and interviews.",
    style: { preset: "karaoke", fontFamily: "Inter", fontWeight: 700, fontSizePct: 5, color: "#ffffff", highlight: "#ffffff", strokeWidth: 5, maxWordsPerLine: 4, uppercase: false } },
  "boxed-dark": { label: "Boxed dark", description: "Words on a dark box, no stroke. Reads on busy footage and screen shares.",
    style: { preset: "boxed", fontFamily: "Inter", fontWeight: 800, fontSizePct: 5.2, color: "#ffffff", highlight: "#ffe600", strokeWidth: 0, maxWordsPerLine: 3, uppercase: false } },
  "pop": { label: "Pop", description: "One or two words at a time, large. For fast talkers and reactions.",
    style: { preset: "popline", fontFamily: "Inter", fontWeight: 900, fontSizePct: 7, color: "#ffffff", highlight: "#ffe600", strokeWidth: 8, maxWordsPerLine: 2, uppercase: true } },
  "stream-pop": { label: "Stream pop", description: "One word at a time, heavy, white with a thick black outline, in the speaker's own case. The accent is the emphasis, not every word.",
    // One word at a time means every word on screen is the spoken one, so a yellow
    // highlight paints the whole video yellow. White here leaves the accent to the
    // emphasis beats, which is where it means something.
    style: { preset: "popline", fontFamily: "Inter", fontWeight: 900, fontSizePct: 5.4, color: "#ffffff", highlight: "#ffffff", strokeWidth: 10, maxWordsPerLine: 1, uppercase: false } },
  "minimal": { label: "Minimal", description: "Small, lower on the frame, no highlight. When the picture matters more than the words.",
    style: { preset: "karaoke", fontFamily: "Inter", fontWeight: 600, fontSizePct: 4, color: "#ffffff", highlight: "#ffffff", strokeWidth: 3, maxWordsPerLine: 5, uppercase: false, positionY: 0.8 } },
};

export const listCaptionLooks = () => Object.entries(CAPTION_LOOKS).map(([id, look]) => ({ id, label: look.label, description: look.description, style: look.style }));
