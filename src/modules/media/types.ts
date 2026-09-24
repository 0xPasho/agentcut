import type { Edit } from "../editor/types";

export type ViewerAsset = { key:string; id:string; name:string; kind:"video"|"image"|"audio"; url:string; duration?:number|null; width?:number|null; height?:number|null; license?:string|null; attribution?:string|null; used?:boolean; removable?:boolean;
  /** A vector — in practice a brand mark. Cropping one to fill a 16:9 tile destroys it, and a dark one vanishes on a dark tile. */
  vector?:boolean;
  /** A video from the library rather than project media: it is imported when it is placed. */
  library?:boolean;
  /** Where this source's own words stand. The same record the agent reads on the media. */
  transcription?:TranscriptionState };

/**
 * A source is never silently wordless. Every state says what it is in words as well
 * as in a mark, because "this video has no captions" and "this video has not been
 * listened to yet" are different facts and only one of them is worth acting on.
 */
export type TranscriptionState={status:"none"|"queued"|"running"|"done"|"failed"|"skipped";reason?:string;words?:number};

export type SfxEdit = Extract<Edit, { type: "sfx" }>;

export type MusicEdit = Extract<Edit, { type: "music" }>;

/** One hit from `assets.searchAudio`. Adopted into the project before it can be placed. */
export type AudioHit = { provider: string; id: string; title: string; durationSec: number; license: string };

export type SortKey = "name" | "size" | "kind" | "date";

/**
 * What `media.transcription` answers. The agent reads the same shape.
 *
 * `effective` is what is in force and `scope` says who decided it: a project
 * override and the environment both outrank the workspace value, so a surface
 * that only knows `effective` cannot tell whether its own save will take effect.
 */
export type TranscriptionReport = {
  media: Array<TranscriptionState & { id: string; name: string }>;
  settings: { effective: { mode: string; scope: string }; workspace: string | null; project: string | null; modes: string[] };
};
