import type { TranscriptionState, SortKey } from "./types";
import { Captions, Clock, Loader2, CircleAlert, CircleSlash, Folder, Film, Image as ImageIcon, Music } from "lucide-react";

export const TRANSCRIPTION_LABEL:Record<TranscriptionState["status"],string>={none:"Not transcribed",queued:"Waiting to transcribe",running:"Transcribing…",done:"Transcribed",failed:"Transcription failed",skipped:"Not transcribed"};

/** One mark per state. Waiting is a clock, not a spinner that has nothing to spin about yet. */
export const TRANSCRIPTION_ICON:Record<TranscriptionState["status"],typeof Captions>={none:Captions,queued:Clock,running:Loader2,done:Captions,failed:CircleAlert,skipped:CircleSlash};

export const ICONS = { folder: Folder, video: Film, image: ImageIcon, audio: Music } as const;

export const KINDS: Record<string, string> = {
  ".mp4": "MPEG-4 movie", ".m4v": "MPEG-4 movie", ".mov": "QuickTime movie",
  ".mkv": "Matroska movie", ".webm": "WebM movie",
  ".jpg": "JPEG image", ".jpeg": "JPEG image", ".png": "PNG image", ".webp": "WebP image",
  ".gif": "GIF image", ".avif": "AVIF image", ".svg": "SVG image",
  ".mp3": "MP3 audio", ".wav": "WAV audio", ".m4a": "Apple MPEG-4 audio",
  ".aac": "AAC audio", ".flac": "FLAC audio", ".ogg": "Ogg audio", ".oga": "Ogg audio",
};

export const COLUMNS: Array<{ key: SortKey; label: string; className: string }> = [
  { key: "name", label: "Name", className: "min-w-0 flex-1 justify-start" },
  { key: "size", label: "Size", className: "w-24 shrink-0 justify-end" },
  { key: "kind", label: "Kind", className: "w-40 shrink-0 justify-start" },
  { key: "date", label: "Date Modified", className: "w-48 shrink-0 justify-start" },
];

/**
 * Pressable surfaces, shared by the rows and the tiles. Glass belongs to the window, not
 * to what sits inside it, so a row is a fill and a highlight rather than a second pane of
 * material — and it gives under the pointer, because a list you pick from should answer.
 */
export const ROW = "cursor-pointer select-none rounded-xl transition-[background-color,box-shadow,scale] duration-150 ease-out motion-reduce:transition-none motion-safe:active:scale-[0.995]";

export const ROW_SELECTED = "bg-linear-to-b from-primary/25 to-primary/12 text-foreground shadow-(--control-highlight) ring-1 ring-inset ring-primary/30";
