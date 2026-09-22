/**
 * One drag vocabulary for every surface that can hand media to the timeline: the asset
 * browser, the preview canvas, the timeline itself, and files dragged in from the desktop.
 */
export const MEDIA_TYPE = "application/x-agentcut-media";

export type DragKind = "video" | "image" | "audio";
export type DragPayload = {
  kind: DragKind;
  /** Project media (video) or library asset (image/audio). Exactly one is set. */
  mediaId?: string;
  assetId?: string;
  /** A file on this computer, from the folder browser: imported when it lands. */
  file?: string;
  /** An online search result: adopted into the library when it lands. */
  search?: { provider: string; id: string; query: string; providers?: string[] };
  name?: string;
  /** Known length in seconds, so a drop preview can show its real footprint before it lands. */
  durationSec?: number | null;
};

const VIDEO = /\.(mp4|mov|mkv|webm|m4v|avi)$/i;
const IMAGE = /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i;
const AUDIO = /\.(mp3|wav|m4a|aac|ogg|flac|opus)$/i;

/** What a desktop file would become in the editor, or null when it is not supported media. */
export function classifyFile(name: string): DragKind | null {
  if (VIDEO.test(name)) return "video";
  if (IMAGE.test(name)) return "image";
  if (AUDIO.test(name)) return "audio";
  return null;
}

export function writeDrag(dataTransfer: DataTransfer, payload: DragPayload) {
  dataTransfer.effectAllowed = "copy";
  dataTransfer.setData(MEDIA_TYPE, JSON.stringify(payload));
}

/** Only readable during drop; `types` is what a dragover handler can inspect. */
export function readDrag(dataTransfer: DataTransfer): DragPayload | null {
  return parseDrag(dataTransfer.getData(MEDIA_TYPE));
}

export function parseDrag(raw: string): DragPayload | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as DragPayload;
    const identified = ["mediaId", "assetId", "file"].some(key => typeof value?.[key as "file"] === "string")
      || (!!value?.search && typeof value.search.provider === "string" && typeof value.search.id === "string");
    if (!value || !identified) return null;
    const kind: DragKind = value.kind === "image" || value.kind === "audio" ? value.kind : "video";
    return { ...value, kind };
  } catch { return null; }
}

export const hasMediaDrag = (types: readonly string[]) => types.includes(MEDIA_TYPE);
export const hasFileDrag = (types: readonly string[]) => types.includes("Files");

/** How long a dropped item occupies the timeline before the author trims it. */
export function dropDuration(payload: Pick<DragPayload, "kind" | "durationSec">, fallback = { image: 3, audio: 8, video: 5 }): number {
  if (payload.durationSec != null && payload.durationSec > 0) return payload.durationSec;
  return fallback[payload.kind];
}

/**
 * A dragover handler cannot read the payload, only its MIME types, so the source of an
 * in-app drag publishes it here. That lets a drop target preview the real footprint of
 * what is coming instead of a bare insertion line.
 */
let active: DragPayload | null = null;
export const setActiveDrag = (payload: DragPayload | null) => { active = payload; };
export const activeDrag = () => active;
