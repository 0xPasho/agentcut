import { getTemplate } from "../../templates/server/registry";
import { aspectOf, deepMerge, resolveTemplate } from "../../templates/lib/resolve";
import { SelectionSpec } from "../types";

/**
 * What a run is being asked to choose, decided in one place.
 *
 * The answer used to be a constant — six clips, twenty to seventy-five seconds,
 * vertical — which meant the only video this app could find in a five-hour stream was
 * a short. It comes from the template now: a template says what kind of video it makes,
 * and this resolves that into the numbers the prompt and the timeline need, with the
 * caller's own instruction over the top.
 */
export type SelectionInput = {
  /** The template this project is made in. With several, the first decides the shape. */
  templateId?: string;
  templateIds?: string[];
  /** A one-off change to the template's selection block: `{ mode: "section", targetSec: 7200 }`. */
  selection?: unknown;
  /** Shorthands the older callers and the analyse form still speak. */
  targetClipCount?: number;
  minSec?: number;
  maxSec?: number;
  /** The shape to fall back to when no template names one — the project's own output. */
  defaultOutput?: { width: number; height: number; fps: number };
};

export type ResolvedSelection = {
  spec: SelectionSpec;
  /** The template the shape came from, to record on the project's plan and apply after. */
  templateId: string | null;
  templateIds: string[];
  /** One line for the activity log, so the owner can see what was understood. */
  summary: string;
};

const VERTICAL = { width: 1080, height: 1920, fps: 30 };

export async function resolveSelection(input: SelectionInput): Promise<ResolvedSelection> {
  const templateIds = [...new Set([...(input.templateId ? [input.templateId] : []), ...(input.templateIds ?? [])])];
  const templateId = templateIds[0] ?? null;
  const template = templateId ? resolveTemplate(await getTemplate(templateId)) : null;

  const output = template?.output ?? input.defaultOutput ?? VERTICAL;
  const shorthand: Record<string, unknown> = {};
  if (input.targetClipCount !== undefined) shorthand.count = input.targetClipCount;
  if (input.minSec !== undefined) shorthand.minSec = input.minSec;
  if (input.maxSec !== undefined) shorthand.maxSec = input.maxSec;

  const merged = deepMerge(deepMerge(template?.selection ?? {}, input.selection ?? {}), shorthand) as Record<string, unknown>;
  const spec = SelectionSpec.parse({ ...merged, output });
  return { spec, templateId, templateIds, summary: describeSelection(spec, template?.name ?? null) };
}

export function describeSelection(spec: SelectionSpec, templateName: string | null): string {
  const shape = aspectOf(spec.output);
  const made = spec.mode === "section"
    ? `one ${spec.targetSec ? `${Math.round(spec.targetSec / 60)}-minute` : `${Math.round(spec.minSec / 60)}–${Math.round(spec.maxSec / 60)} minute`} ${shape} video, cut from one stretch of the recording`
    : `${spec.count} ${shape} clips of ${spec.minSec}–${spec.maxSec}s`;
  return templateName ? `${made}, in ${templateName}` : made;
}
