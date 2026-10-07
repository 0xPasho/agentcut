import { TemplateComment } from "../types";

/**
 * The `pop` comment as a stream short reads a viewer out: the dark chat bubble, the frame
 * blurred behind it, a bubble-burst on landing, held at least 2.4 s. The Stream shorts
 * pack's comment template carries these values, and a comment placed by hand in the pop
 * style uses them when the video has no template saying otherwise.
 */
export const POP_COMMENT = TemplateComment.parse({
  enabled: true,
  style: "pop",
  card: "chat",
  seconds: 2.4,
  maxSeconds: 2.4,
  latestSec: 1,
  lookbackSec: 900,
  delaySec: 0.6,
  blur: 24,
  y: 0.42,
  widthPct: 94,
  sound: { enabled: true, starter: "bubble", gain: 1.4, durationSec: 0.3 },
});

/** Who wrote the blur under a comment placed by hand, so replacing the comment takes it away too. */
export const COMMENT_AUTHOR = "comment";
