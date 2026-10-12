import { z } from "zod";

/**
 * An idea is the step before a project: something seen on the web, plus what the
 * person said about it, waiting to become a video. It is captured from the browser
 * extension (or typed here), developed into a brief by one or more harnesses side by
 * side, and moved across the board until it is started as a project.
 */
export const IDEA_STATUSES = ["inbox", "developing", "ready", "production", "done"] as const;
export const IdeaStatus = z.enum(IDEA_STATUSES);
export type IdeaStatus = z.infer<typeof IdeaStatus>;

export const RefKind = z.enum(["page", "x_post", "video", "image", "selection", "element"]);
export type RefKind = z.infer<typeof RefKind>;

export const RefMedia = z.object({
  type: z.enum(["image", "video"]),
  url: z.string().max(4000),
  poster: z.string().max(4000).optional(),
});
export type RefMedia = z.infer<typeof RefMedia>;

/**
 * One thing saved from the web, as the extension read it off the page. Everything is
 * optional but the URL because pages are unreliable: a post without metrics or a video
 * without a description is still worth keeping.
 */
export const ReferenceInput = z.object({
  kind: RefKind.default("page"),
  /** The item's own address: the post, the reel, the video — never the feed it was seen in. */
  url: z.string().max(4000),
  /** A deep link to the exact moment or passage: a video at its second, a text fragment. */
  anchor: z.string().max(6000).optional(),
  /** The page it was saved from, when that is not `url` (a post seen in a feed). */
  pageUrl: z.string().max(4000).optional(),
  site: z.string().max(200).optional(),
  title: z.string().max(1000).optional(),
  author: z.string().max(300).optional(),
  handle: z.string().max(300).optional(),
  publishedAt: z.string().max(100).optional(),
  text: z.string().max(20_000).optional(),
  /** Free-form numbers the page showed: likes, views, reposts, duration. */
  metrics: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
  media: z.array(RefMedia).max(20).optional(),
  /** Seconds into a video when it was saved. */
  atSec: z.number().nonnegative().optional(),
  /** What the person said about it when they saved it: "the same, but for sardines". */
  note: z.string().max(5000).optional(),
  /** A `data:image/...;base64,` screenshot; stored as a file, never in the row. */
  screenshot: z.string().max(12_000_000).optional(),
});
export type ReferenceInput = z.infer<typeof ReferenceInput>;
/** A reference before defaults are applied, as callers hand it over. */
export type ReferenceDraft = z.input<typeof ReferenceInput>;

export const MEDIA_STATUSES = ["none", "pending", "done", "failed"] as const;
export type MediaStatus = (typeof MEDIA_STATUSES)[number];

/**
 * A save: something kept while browsing, before anybody decided what it is for. Ideas
 * are built later from several of them, and one save can feed several ideas.
 */
export type Save = Omit<ReferenceInput, "screenshot"> & {
  id: string;
  /** File name under the save's folder, served by /api/saves/<id>/files/<name>. */
  screenshot: string | null;
  /** The video itself, downloaded so the save outlives the post. */
  mediaStatus: MediaStatus;
  mediaFile: string | null;
  mediaError: string | null;
  /** What is said in the video has been recognised already: the preview shows it at once. */
  hasTranscript: boolean;
  ideaIds: string[];
  createdAt: number;
};

export const SavePatch = z.object({
  /** Replaces the note. */
  note: z.string().max(5000).optional(),
  /** Added after the note, on a new line: what was said a moment after saving. */
  appendNote: z.string().max(5000).optional(),
});
export type SavePatch = z.infer<typeof SavePatch>;

export const RUN_STATUSES = ["running", "done", "error", "stopped", "interrupted"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const BeatKind = z.enum(["hook", "point", "payoff", "outro", "other"]);

/** What a harness hands back. Loose on purpose: a missing field is not a failed run. */
export const Brief = z.object({
  title: z.string().default(""),
  angle: z.string().default(""),
  hooks: z.array(z.string()).default([]),
  format: z.object({
    platform: z.string().default(""),
    aspect: z.string().default(""),
    lengthSec: z.number().nullable().default(null),
  }).partial().default({}),
  beats: z.array(z.object({ kind: BeatKind.catch("other"), text: z.string() })).default([]),
  script: z.string().default(""),
  shots: z.array(z.string()).default([]),
  whyItWorks: z.string().default(""),
  tags: z.array(z.string()).default([]),
});
export type Brief = z.infer<typeof Brief>;

/** One harness developing one idea. Several run side by side. */
export type IdeaRun = {
  id: string;
  ideaId: string;
  harness: string;
  model: string | null;
  status: RunStatus;
  instruction: string;
  /** The agent's last progress line, for a card that shows something is happening. */
  activity: string;
  text: string;
  brief: Brief | null;
  error: string | null;
  costUsd: number | null;
  startedAt: number;
  endedAt: number | null;
};

export type Idea = {
  id: string;
  title: string;
  status: IdeaStatus;
  /** What the person typed or dictated. */
  note: string;
  tags: string[];
  /** Order inside its column; lower first. */
  position: number;
  /** The run whose brief the idea uses; the latest finished one when unset. */
  chosenRunId: string | null;
  projectId: string | null;
  createdAt: number;
  updatedAt: number;
  saves: Save[];
  runs: IdeaRun[];
};

export const DevelopRequest = z.object({
  harnesses: z.array(z.string()).min(1).max(4),
  /** Per-harness model, by harness id. Absent uses the harness's own default. */
  models: z.record(z.string(), z.string()).optional(),
  /** Extra direction for this round, on top of the note. */
  instruction: z.string().max(5000).optional(),
});
export type DevelopRequest = z.infer<typeof DevelopRequest>;

/**
 * A new idea, or more for one that exists: saves already kept (`saveIds`), new ones
 * captured with it (`refs`), and optionally the harnesses to develop it with at once.
 */
export const CaptureRequest = z.object({
  ideaId: z.string().optional(),
  title: z.string().max(300).optional(),
  note: z.string().max(20_000).default(""),
  saveIds: z.array(z.string()).max(50).default([]),
  refs: z.array(ReferenceInput).max(20).default([]),
  develop: DevelopRequest.optional(),
});
export type CaptureRequest = z.infer<typeof CaptureRequest>;

export const IdeaPatch = z.object({
  title: z.string().min(1).max(300).optional(),
  note: z.string().max(20_000).optional(),
  status: IdeaStatus.optional(),
  tags: z.array(z.string().max(60)).max(30).optional(),
  position: z.number().optional(),
  chosenRunId: z.string().nullable().optional(),
  projectId: z.string().nullable().optional(),
});
export type IdeaPatch = z.infer<typeof IdeaPatch>;

/** A column of the board. */
export type IdeaColumn = { status: IdeaStatus; label: string; hint: string };

export type IdeasPageData = { ideas: Idea[]; openId: string | null };
export type SavesPageData = { saves: Save[] };

/** A harness as the develop picker shows it. */
export type HarnessOption = { id: string; label: string; ready: boolean; reason: string };

/** Everything the board can do to its ideas, handed to the cards and the detail. */
export type IdeasActions = {
  refresh: () => Promise<void>;
  create: (note: string) => Promise<Idea>;
  patch: (id: string, patch: IdeaPatch) => Promise<void>;
  move: (id: string, status: IdeaStatus, index: number) => Promise<void>;
  remove: (id: string) => Promise<void>;
  unlinkSave: (id: string, saveId: string) => Promise<void>;
  develop: (id: string, request: DevelopRequest) => Promise<void>;
  stop: (id: string) => Promise<void>;
  startProject: (idea: Idea) => Promise<void>;
};

/** What the library sends to make an idea from the saves picked in it. */
export type BuildIdeaRequest = { saveIds: string[]; note: string; title?: string; develop?: DevelopRequest };

export type SavesActions = {
  refresh: () => Promise<void>;
  setNote: (id: string, note: string) => Promise<void>;
  remove: (ids: string[]) => Promise<void>;
  buildIdea: (request: BuildIdeaRequest) => Promise<void>;
};
