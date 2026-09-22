/** How a project's status reads as a badge. */
export const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  ready: "secondary",
  error: "destructive",
  new: "outline",
};

/**
 * The shapes the home screen offers, by name. Choosing one is a decision about the video
 * being made; without one the project takes the shape of its first source.
 */
export const ASPECTS: Record<string, { width: number; height: number; fps: number }> = {
  "9:16": { width: 1080, height: 1920, fps: 30 },
  "4:5": { width: 1080, height: 1350, fps: 30 },
  "1:1": { width: 1080, height: 1080, fps: 30 },
  "16:9": { width: 1920, height: 1080, fps: 30 },
};
