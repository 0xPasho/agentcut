import { Clip as ClipSchema, type Edit, type CaptionStyle, type MediaSource } from "./types";
import { EASE_LABELS } from "./lib/motion";
import { TRANSITION_LABELS } from "./lib/transitions";

// Display-only fallback for an empty timeline. Never saved as source footage.
export const EMPTY = ClipSchema.parse({ id: "empty", title: "Empty canvas", start: 0, end: 5, captions: { preset: "none" } });

/** Narrower than this and the measurement is a half-laid-out column, not a preview. */
export const MIN_PREVIEW_PX = 80;

export const NEW_EDIT: Record<string, (t: number) => Edit> = {
  silence: t => ({ type: "silence", t, d: 0.4, by: "" }),
  punch: t => ({ type: "punch", t, d: 1.2, scale: 1.12, by: "" }),
  emphasis: t => ({ type: "emphasis", t, d: 1, words: [], color: "#ffe600", by: "" }),
  text: t => ({ type: "text", t, d: 3, text: "New title", position: "top", x: null, y: null, style: "card", color: "", background: "", fontScale: 1, by: "" }),
};

export const SNAP_PX = 8;

/** Enough of the resize handle stays inside the frame to be grabbed at any size. */
export const HANDLE_PX = 16;

export const ARROWS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

export const PRESETS: CaptionStyle["preset"][] = ["karaoke", "popline", "boxed", "none"];

/** Where each preset's block roughly centres, so switching to a free position starts from there. */
export const PRESET_Y = { top: 0.15, center: 0.5, bottom: 0.78 } as const;

/** When a template carries no brand kit, these are the colours a hook and a caption reach for. */
export const DEFAULT_PALETTE = ["#ffe600", "#ffffff", "#000000", "#ff4d4d", "#4dd4ff", "#7cff6b"];

/** Where the hook sits on the frame, in the words the panel shows rather than the schema's. */
export const POSITION_LABELS = { top: "Top", center: "Middle", bottom: "Bottom" } as const;

/** The bar keeps its height with nothing selected, so picking a clip never resizes the frame. */
export const TOOLBAR_ROW = "flex min-h-11 shrink-0 items-center justify-center";

/**
 * A motion keyframe's geometry is a percentage of the OUTPUT frame; `crop`'s is source
 * pixels. The two share field names, so a keyframe says which one it means.
 */
export const MOTION_NAMES: Record<string, string> = { t: "Moment (seconds)", x: "Left (% of frame)", y: "Top (% of frame)", width: "Width (%)", height: "Height (%)", rotation: "Rotation (degrees)", opacity: "Opacity (0–1)", volume: "Volume (0–2)" };

/**
 * What each choice in an enumerated field is called. The schema's own values are what
 * the agent writes; these are what a person reads, and they are the same words the
 * Motion panel and the timeline's seam menu use rather than a second vocabulary.
 */
export const OPTION_LABELS: Record<string, string> = { ...EASE_LABELS, ...TRANSITION_LABELS, left: "The left", right: "The right", up: "Above", down: "Below" };

export const TRANSFORM_FIELDS = [['x','Left (%)'],['y','Top (%)'],['width','Width (%)'],['height','Height (%)'],['rotation','Rotation (degrees)'],['opacity','Opacity']] as const;

export const LABEL_WIDTH = 76;

export const NO_MORE_FOOTAGE = "This clip has no more footage that way.";

export const EMPTY_MEDIA: MediaSource[] = [];

/** Frames sampled across what the clip shows, so the strip changes with the footage. */
export const STRIP_FRAMES = 5;

/** Every gesture the timeline understands, in one place, so none of them has to be guessed. */
export const GROUPS: { title: string; rows: [string, string][] }[] = [
  { title: "Editing", rows: [
    ["S", "Split the selected clip at the playhead"],
    ["D", "Duplicate the selected clip"],
    ["Delete", "Remove the focused clip and close its gap"],
    ["Cmd / Ctrl + C", "Copy the selected clip"],
    ["Cmd / Ctrl + V", "Paste it at the playhead"],
    ["Cmd / Ctrl + Z", "Undo"],
    ["Shift + Cmd / Ctrl + Z", "Redo"],
  ] },
  { title: "Dragging", rows: [
    ["Drag a clip", "Move it along its track or onto another one"],
    ["Drag a clip edge", "Trim it; main-track trims ripple the clips after it"],
    ["Alt + drag onto Main", "Insert between clips and close the gap"],
    ["Cmd / Ctrl while dragging", "Bypass snapping for this drag"],
    ["Right-click a clip", "Split, duplicate, mute, hide or remove it"],
    ["Shift / Cmd + click", "Add a clip to the selection; drag one to move them all"],
  ] },
  { title: "Adding media", rows: [
    ["Drag onto a track", "Place an asset, a folder file, an online image or a desktop file"],
    ["Drop on a clip's middle", "Replace that clip's media, keeping its place"],
    ["Drop on the preview", "Place it where you dropped it in the frame"],
    ["Drop on the asset panel", "Import it into the project without placing it"],
  ] },
  { title: "Playback", rows: [
    ["Space or K", "Play or pause"],
    [", and .", "Step one frame back or forward"],
    ["Up / Down", "Jump to the previous or next cut"],
    ["Home / End", "Jump to the start or the end"],
  ] },
  { title: "Moving around", rows: [
    ["Cmd / Ctrl + wheel", "Zoom the timeline around the pointer"],
    ["Pinch on a trackpad", "The same zoom"],
    ["Shift + wheel", "Scroll the timeline sideways"],
    ["Drag past an edge", "Scrolls while you keep dragging"],
  ] },
  { title: "Keyboard on a clip", rows: [
    ["Arrow keys", "Nudge one frame; Shift nudges one second"],
    ["Alt + arrows on Main", "Reorder it among the main clips"],
    ["Arrows on an edge", "Trim one frame at a time"],
  ] },
];

export const LANES: Array<{ type: Edit["type"]; label: string; className: string }> = [
  { type: "silence", label: "Silence", className: "bg-destructive/80 text-white" },
  { type: "punch", label: "Punch", className: "bg-[#ffda2a] text-black" },
  { type: "emphasis", label: "Emphasis", className: "bg-[#ed8445] text-white" },
  { type: "text", label: "Title", className: "bg-white text-black" },
  { type: "image", label: "Image", className: "bg-[#7c6cf5] text-white" },
];

export const FRAME = "mx-auto w-full overflow-hidden rounded-3xl bg-black ring-1 ring-foreground/10";

/**
 * A 9:16 preview filling a 340px rail is 600px tall — taller than the panel beside
 * it and taller than most windows. Cap the tall ones by height and centre them.
 */
export const MAX_HEIGHT = 460;
