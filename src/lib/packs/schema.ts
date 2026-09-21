import { z } from "zod";
import { GlossaryTerm } from "../glossary";

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
}).strict();
export type InstalledPack = z.infer<typeof InstalledPack>;
