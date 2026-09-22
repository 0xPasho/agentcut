import type { TranscriptionState, ViewerAsset, SortKey, TranscriptionReport } from "./types";
import { TRANSCRIPTION_LABEL, KINDS } from "./data";
import type { FolderEntry } from "./server/local-assets";

/** One state, in one sentence, wherever it is read out: a tile, a caption, a live region. */
export function transcriptionSentence(state:TranscriptionState){
  const label=TRANSCRIPTION_LABEL[state.status];
  if(state.status==='done')return `${label} · ${state.words??0} words`;
  return state.reason?`${label} — ${state.reason}`:label;
}

/**
 * The tile's whole name. Its own `aria-label` wins over everything inside it, so the
 * marks in the corner — used here, being listened to, failed — have to be said in it
 * or they are said to nobody.
 */
export const tileLabel=(asset:ViewerAsset)=>[`Select asset ${asset.name}`,asset.used?"used in this edit":"",
  asset.transcription&&asset.transcription.status!=="none"?transcriptionSentence(asset.transcription).toLowerCase():""].filter(Boolean).join(", ");

export const durationLabel=(seconds?:number|null)=>seconds==null?null:`${Math.floor(seconds/60)}:${Math.floor(seconds%60).toString().padStart(2,"0")}`;

export const num = (v: number | readonly number[]) => (Array.isArray(v) ? v[0] : (v as number));

export const soundName = (name: string) => name.replace(/\.[a-z0-9]+$/i, "");

export const extension = (name: string) => {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot).toLowerCase() : "";
};

export const kindLabel = (entry: FolderEntry) =>
  entry.kind === "folder" ? "Folder" : KINDS[extension(entry.name)] ?? `${extension(entry.name).slice(1).toUpperCase() || "Unknown"} file`;

/** Finder's own rounding: whole kilobytes, one decimal for megabytes, two for gigabytes. */
export function sizeLabel(bytes: number | null) {
  if (bytes === null) return "--";
  if (bytes < 1000) return `${bytes} bytes`;
  const units = [
    { scale: 1e3, suffix: "KB", decimals: 0 },
    { scale: 1e6, suffix: "MB", decimals: 1 },
    { scale: 1e9, suffix: "GB", decimals: 2 },
    { scale: 1e12, suffix: "TB", decimals: 2 },
  ];
  const unit = units.findLast(u => bytes >= u.scale) ?? units[0];
  return `${(bytes / unit.scale).toFixed(unit.decimals)} ${unit.suffix}`;
}

export function dateLabel(ms: number) {
  if (!ms) return "--";
  const date = new Date(ms);
  const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (date.toDateString() === new Date().toDateString()) return `Today at ${time}`;
  return `${date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })} at ${time}`;
}

export function compare(a: FolderEntry, b: FolderEntry, key: SortKey) {
  if (key === "size") return (a.size ?? 0) - (b.size ?? 0);
  if (key === "date") return a.modifiedAt - b.modifiedAt;
  if (key === "kind") return kindLabel(a).localeCompare(kindLabel(b)) || a.name.localeCompare(b.name);
  return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
}

export const wordsFor = (report: TranscriptionReport | null, mediaId: string): TranscriptionState | undefined =>
  report?.media.find(m => m.id === mediaId);
