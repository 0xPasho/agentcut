import fs from "node:fs/promises";
import path from "node:path";
import { WORKSPACE } from "../config";
import { BUILTIN_TEMPLATES } from "./builtin";
import { VideoTemplate, type TemplateRecord } from "./schema";

/**
 * Templates are files, not code. Built-ins ship with the app; anything in the
 * workspace's `templates/` folder is a user template and takes precedence over a
 * built-in with the same id, so "start from ours and change it" works by copying
 * a file. The agent reads and writes the same folder through the same functions.
 */
export const templatesDir = () => path.join(WORKSPACE, "templates");

type RawTemplate = { raw: Record<string, unknown>; file: string };

async function readUserTemplates(): Promise<RawTemplate[]> {
  const dir = templatesDir();
  const files = await fs.readdir(dir).catch(() => [] as string[]);
  const records: RawTemplate[] = [];
  for (const name of files.filter((f) => f.endsWith(".json")).sort()) {
    const file = path.join(dir, name);
    try {
      const raw = JSON.parse(await fs.readFile(file, "utf8"));
      VideoTemplate.pick({ id: true, name: true, extends: true }).parse(raw);
      records.push({ raw, file });
    } catch (error) {
      // One malformed file must not hide every other template.
      console.error(`Ignoring invalid template ${name}: ${(error as Error).message}`);
    }
  }
  return records;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const deepMerge = (base: unknown, patch: unknown): unknown => {
  if (!isPlainObject(patch)) return patch;
  const target: Record<string, unknown> = isPlainObject(base) ? { ...base } : {};
  for (const [key, value] of Object.entries(patch)) target[key] = deepMerge(target[key], value);
  return target;
};

/**
 * `extends` is resolved here, once, against the raw document: a child that says
 * `{"extends":"explainer-broll","captions":{"uppercase":false}}` is the parent with
 * that one field changed, not the parent buried under a child's defaults.
 */
export async function listTemplates(): Promise<TemplateRecord[]> {
  const user = await readUserTemplates();
  const builtinById = new Map(BUILTIN_TEMPLATES.map((t) => [t.id, t]));
  const rawById = new Map(user.map((u) => [String(u.raw.id), u]));
  const resolved = new Map<string, TemplateRecord>();
  const resolve = (id: string, chain: string[]): VideoTemplate => {
    if (chain.includes(id)) throw new Error(`Template ${chain[0]} extends itself through ${chain.join(" → ")}`);
    const own = rawById.get(id);
    if (!own) {
      const builtin = builtinById.get(id);
      if (!builtin) throw new Error(`Template ${chain[chain.length - 1] ?? id} extends ${id}, which does not exist`);
      return builtin;
    }
    const parentId = typeof own.raw.extends === "string" ? own.raw.extends : null;
    if (!parentId) return VideoTemplate.parse(own.raw);
    const parent = resolve(parentId, [...chain, id]);
    const { extends: _e, ...patch } = own.raw; void _e;
    return { ...VideoTemplate.parse(deepMerge(parent, patch)), extends: parentId };
  };
  for (const u of user) {
    const id = String(u.raw.id);
    try { resolved.set(id, { ...resolve(id, []), builtin: false, file: u.file }); }
    catch (error) { console.error(`Ignoring template ${path.basename(u.file)}: ${(error as Error).message}`); }
  }
  const builtin = BUILTIN_TEMPLATES.filter((t) => !resolved.has(t.id)).map((t): TemplateRecord => ({ ...t, builtin: true, file: null }));
  return [...builtin, ...resolved.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export async function getTemplate(id: string): Promise<TemplateRecord> {
  const found = (await listTemplates()).find((template) => template.id === id);
  if (!found) throw new Error(`Template not found: ${id}. Use templates.list to see what exists.`);
  return found;
}

/** Create or replace a user template. Built-ins on disk are never modified. */
export async function saveTemplate(input: unknown): Promise<TemplateRecord> {
  const template = VideoTemplate.parse(input);
  if (template.extends && !(await listTemplates()).some((t) => t.id === template.extends)) throw new Error(`Template ${template.id} extends ${template.extends}, which does not exist`);
  if (template.extends === template.id) throw new Error(`Template ${template.id} extends itself`);
  const dir = templatesDir();
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${template.id}.json`);
  const temp = `${file}.${process.pid}.tmp`;
  // A document with `extends` is stored as the sparse patch it was given, so the parent
  // keeps flowing through; anything else is stored whole.
  const document = template.extends && isPlainObject(input) ? input : template;
  await fs.writeFile(temp, JSON.stringify(document, null, 2));
  await fs.rename(temp, file);
  try { return await getTemplate(template.id); }
  catch (error) { await fs.rm(file, { force: true }); throw error; }
}

/**
 * Save a variation of an existing template. The merge is the same `mergeTemplate` an
 * override uses at apply time, so "save these settings" and "apply these settings"
 * cannot mean different things — the panel used to re-merge the sections it knew about,
 * which silently ignored any section added later.
 */
export async function saveTemplateFrom(
  from: string,
  changes: { id: string; name: string; author?: string; overrides?: unknown },
): Promise<TemplateRecord> {
  const { mergeTemplate } = await import("./plan");
  const base = mergeTemplate(await getTemplate(from), changes.overrides);
  const { builtin, file, ...document } = base as TemplateRecord;
  void builtin; void file;
  return saveTemplate({ ...document, id: changes.id, name: changes.name, author: changes.author ?? "" });
}

export async function deleteTemplate(id: string): Promise<{ deleted: boolean }> {
  const file = path.join(templatesDir(), `${path.basename(id)}.json`);
  try {
    await fs.unlink(file);
    return { deleted: true };
  } catch {
    throw new Error(`No user template named ${id}. Built-in templates cannot be deleted; save one with the same id to override it.`);
  }
}

/** The JSON Schema a template author (or an agent) writes against. */
export const templateSchema = async () => {
  const { z } = await import("zod");
  return z.toJSONSchema(VideoTemplate, { io: "input" });
};
