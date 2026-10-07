/**
 * The human half of the template feature. Every button here calls the same
 * project tool an agent calls — `template.plan` to see what it would do, then
 * `template.apply` to commit it through the shared operation engine. There is no
 * second code path behind this panel.
 */

export const SOURCE_LABELS: Record<string, string> = {
  slot: "Your pictures", brand: "Brand logos", project: "Project assets",
  frame: "Frames from this footage", web: "Image search",
};

export const ALL_SOURCES = ["slot", "brand", "project", "frame", "web"];

/** Base UI prints the raw value unless the trigger is told what to show. */
export const HOOK_LABELS: Record<string, string> = {
  sticky: "Stays on screen the whole video", intro: "Opening card only", off: "No hook",
};

export const FRAMING_LABELS: Record<string, string> = {
  source: "Leave each shot's own framing", crop: "Centre of the frame", split: "Screen and person, stacked",
};

export const CAMERA_LABELS: Record<string, string> = { top: "Person on top", bottom: "Person underneath" };

export const MODE_LABELS: Record<string, string> = {
  auto: "Only where a sentence names something", alternate: "Every other sentence",
  every: "Every sentence that can be illustrated", off: "No pictures",
};

export const STYLE_LABELS: Record<string, string> = {
  auto: "Automatic — logo for a brand, card otherwise", card: "Photo card",
  plain: "Bare picture", logo: "Logo plate",
};
