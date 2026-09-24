/**
 * The metric catalogue: everything a pack may hold its videos to, and nothing else.
 *
 * The host owns this list because the host is the only thing that can take a
 * measurement. A pack picks a name and sets a limit, which is what keeps a pack data
 * rather than a program — and what makes it checkable before it is installed, since a
 * check naming something that is not here is a defect the person can see on the inspect
 * page rather than a review that silently never runs.
 */

export type MetricStage = "project" | "export";

export type Metric = {
  name: string;
  stage: MetricStage;
  kind: "number" | "boolean";
  /** What it is, in the sentence the inspect page and the tool schema show. */
  what: string;
  unit?: string;
};

/** Read off the project itself, before anything is rendered. */
const PROJECT_METRICS: Metric[] = [
  { name: "video.durationSec", stage: "project", kind: "number", unit: "s", what: "How long the finished video runs." },
  { name: "video.shots", stage: "project", kind: "number", what: "Shots on the main track." },
  { name: "video.cutsPerMin", stage: "project", kind: "number", what: "Cuts per minute of output, silence cuts included." },
  { name: "video.longestShotSec", stage: "project", kind: "number", unit: "s", what: "The longest stretch with no cut in it." },
  { name: "captions.on", stage: "project", kind: "boolean", what: "The video draws captions at all." },
  { name: "captions.wordsPerSec", stage: "project", kind: "number", what: "Words drawn per second across the body." },
  { name: "captions.positionY", stage: "project", kind: "number", what: "Where the caption band sits, 0 at the top and 1 at the bottom." },
  { name: "captions.crossesSeam", stage: "project", kind: "boolean", what: "A two-row caption line is cut in half by the seam of a split." },
  { name: "captions.overPerson", stage: "project", kind: "boolean", what: "The caption band sits over the camera half rather than the screen half." },
  { name: "hook.present", stage: "project", kind: "boolean", what: "There is a hook line to hold." },
  { name: "hook.words", stage: "project", kind: "number", what: "How many words the hook is." },
  { name: "images.perMin", stage: "project", kind: "number", what: "Pictures placed per minute." },
  { name: "silence.longestGapSec", stage: "project", kind: "number", unit: "s", what: "The longest pause left in after the silence cuts." },
  { name: "transitions.count", stage: "project", kind: "number", what: "Joints carrying a transition rather than a hard cut." },
  { name: "layers.max", stage: "project", kind: "number", what: "The highest layer in use; 0 is a single track." },
  { name: "endCard.present", stage: "project", kind: "boolean", what: "The video ends on a card." },
  { name: "layout.isSplit", stage: "project", kind: "boolean", what: "The footage is stacked as a split — the screen and the person — rather than one crop." },
];

/**
 * Read back out of the export's own pixels. Every one of these is a number
 * `render/server/style-check.ts` already computes; what moves into the pack is the limit
 * beside it, which used to be typed into the code.
 */
const EXPORT_METRICS: Metric[] = [
  { name: "framing.worstDrift", stage: "export", kind: "number", unit: "/255", what: "Worst difference between the rendered pane and the source region the layout names, over four moments with no push-in in them." },
  { name: "hook.minOverFootage", stage: "export", kind: "number", unit: "/255", what: "The least the hook band is drawn over the footage under it, across the body." },
  { name: "hook.whiteShare", stage: "export", kind: "number", unit: "0..1", what: "Ink in the hook band, for a video whose band cannot be read against its source." },
  { name: "hook.offCardShare", stage: "export", kind: "number", unit: "0..1", what: "Ink in the hook band one second into the end card." },
  { name: "hook.goneAfter", stage: "export", kind: "boolean", what: "An opening hook is off the screen once its time is up." },
  { name: "captions.litMinusDark", stage: "export", kind: "number", unit: "/255", what: "The caption band on the longest spoken word, minus the same band in a gap, both read against the footage underneath." },
  { name: "captions.bandLitMinusDark", stage: "export", kind: "number", unit: "/255", what: "The same reading for a video whose band cannot be compared with its source: the band's own brightness on a word, minus its brightness in a gap." },
  { name: "endCard.diff", stage: "export", kind: "number", unit: "/255", what: "Difference between the end card as exported and the card asset itself." },
  { name: "endCard.playedDeltaSec", stage: "export", kind: "number", unit: "s", what: "How much of the end card was cut off." },
];

export const METRICS: Metric[] = [...PROJECT_METRICS, ...EXPORT_METRICS];
export const METRICS_BY_NAME = new Map(METRICS.map((m) => [m.name, m]));
export const metric = (name: string): Metric | undefined => METRICS_BY_NAME.get(name);

/**
 * What `style.audit` held a video to before a pack could say. These are the thresholds
 * that were written into `style-check.ts`, kept here as the standard a video with no pack
 * behind it is still read against, so the audit says the same thing it always did.
 */
export const BUILTIN_CHECKS = [
  { id: "framing", metric: "framing.worstDrift", max: 18, severity: "critical" as const, fix: "The pane is not the region the layout names — re-apply the template." },
  { id: "hook", metric: "hook.minOverFootage", min: 20, severity: "critical" as const, fix: "The hook card is not on the screen where the template puts it." },
  { id: "hook-ends", metric: "hook.goneAfter", is: true, severity: "suggestion" as const, fix: "The opening hook is still up after its time; shorten it or make it sticky." },
  { id: "hook-off-card", metric: "hook.offCardShare", max: 0.2, severity: "critical" as const, fix: "The hook is drawn over the end card. A card is a composition of its own." },
  { id: "captions", metric: "captions.litMinusDark", min: 5, severity: "critical" as const, fix: "A word being spoken does not light the caption band." },
  { id: "captions-band", metric: "captions.bandLitMinusDark", min: 4, severity: "critical" as const, fix: "A word being spoken does not light the caption band." },
  { id: "end-card", metric: "endCard.diff", max: 12, severity: "critical" as const, fix: "The end card is not the card asset. Check what is drawn over it." },
  { id: "end-card-length", metric: "endCard.playedDeltaSec", max: 0.2, severity: "critical" as const, fix: "The end card does not play whole; give it its full length." },
];

/** Where a video's reviews live, relative to the project folder. */
export const REVIEWS_DIR = "reviews";

/** A pack's standard, inside the pack. Named here so nothing has to import the review module to look for one. */
export const PACK_REVIEW_FILE = "review.json";
