import { z } from "zod";
import { GlossaryTerm } from "../rules/types";

/**
 * A pack is the unit that travels: templates, rules, glossary entries, assets and
 * quick actions that belong together, with a manifest. A folder with `pack.json`,
 * `templates/`, `rules/` and `assets/` — servable from any static host, importable
 * by path or URL. Nothing in a pack is code.
 */
export const PackAsset = z.object({
  /** Path inside the pack, e.g. `assets/outro.mp4`. */
  file: z.string().min(1),
  kind: z.enum(["image", "audio", "video"]),
  name: z.string().min(1),
  tags: z.string().default(""),
  license: z.string().default(""),
  attribution: z.string().default(""),
  /** The id this asset had when the pack was exported, so templates and rules in the pack can point at it. */
  id: z.string().optional(),
}).strict();

/**
 * A reference video or picture: what a finished video in this style looks like. The
 * agents cannot watch a video, so a video example is read as a sheet of stills taken
 * across it, beside the note that says what to take from it.
 */
export const PackExample = z.object({
  /** Path inside the pack, e.g. `examples/dos-tipos-de-ingeniero.mp4`. */
  file: z.string().min(1),
  kind: z.enum(["image", "video"]),
  title: z.string().default(""),
  /** What to notice: "the question from the chat opens it; the sentence stays up, the spoken word is yellow". */
  note: z.string().default(""),
}).strict();
export type PackExample = z.infer<typeof PackExample>;

export const QuickAction = z.object({
  label: z.string().min(1).max(40),
  /** The message sent to the agent. `{selection}` is replaced with the selected clip's title, or "this video". */
  text: z.string().min(1),
}).strict();
export type QuickAction = z.infer<typeof QuickAction>;

export const PackManifest = z.object({
  schema: z.literal(1).default(1),
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "lowercase letters, digits and dashes"),
  name: z.string().min(1),
  version: z.string().default("1.0.0"),
  description: z.string().default(""),
  author: z.string().default(""),
  /** Template ids; each is `templates/<id>.json` in the pack. */
  templates: z.array(z.string()).default([]),
  /** Rule ids; each is `rules/<id>.json`, with any prompt file beside it. */
  rules: z.array(z.string()).default([]),
  glossary: z.array(GlossaryTerm).default([]),
  assets: z.array(PackAsset).default([]),
  quickActions: z.array(QuickAction).default([]),
  /**
   * The pack's style guide: who the videos are for, what a good one is, how its hooks
   * sound and what it never does — in prose, the part of an editor's judgement a template
   * cannot hold. A Markdown file in the pack, usually `STYLE.md`. Empty is none.
   */
  style: z.string().default(""),
  examples: z.array(PackExample).default([]),
}).strict();
export type PackManifest = z.infer<typeof PackManifest>;

/** What the workspace remembers about an installed pack. */
export const InstalledPack = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string(),
  description: z.string().default(""),
  author: z.string().default(""),
  source: z.string(),
  /** sha256 of pack.json as installed. */
  hash: z.string(),
  installedAt: z.number(),
  templates: z.array(z.string()).default([]),
  rules: z.array(z.string()).default([]),
  /** Asset ids in this workspace, by the id they had in the pack. */
  assets: z.record(z.string(), z.string()).default({}),
  glossary: z.array(z.string()).default([]),
  quickActions: z.array(QuickAction).default([]),
  /**
   * Everything the pack's manifest names, whether or not installing it wrote the file:
   * a template this workspace already had is still the pack's template, and the style
   * guide that belongs to a video is found through it.
   */
  provides: z.object({ templates: z.array(z.string()).default([]), rules: z.array(z.string()).default([]) }).prefault({}),
  /** The examples, with `file` relative to the pack's folder in the workspace. */
  examples: z.array(PackExample).default([]),
}).strict();
export type InstalledPack = z.infer<typeof InstalledPack>;

/** A pack's style guide as the editor and the tools return it: each example with the still to open. */
export type PackStyle = {
  pack: string;
  name: string;
  text: string;
  examples: Array<PackExample & { still: string }>;
};

/** Which guide a project's videos are made to, and why. */
export type ActiveStyleView = {
  pack: string | null;
  name: string;
  reason: string;
  choice: string | null;
};
