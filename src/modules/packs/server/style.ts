import fs from "node:fs/promises";
import path from "node:path";
import { db } from "../../../common/server/db";
import { kindFor } from "../../media/server/assets";
import { contactSheet } from "../../media/server/ffmpeg";
import { readEditor } from "../../editor/server/store";
import { PACK_REVIEW_FILE } from "../../review/data";
import { scanStyle, styleBlock, styleRefusal } from "../lib/style";
import { InstalledPack, type PackExample } from "../types";
import { listPacks, packFolder, packsDir } from "./packs";

/**
 * A pack's style guide and reference videos, as installed in this workspace, and which
 * guide a given video is made to. The panel and the agent tools are these functions.
 *
 * An installed pack keeps its record at `packs/<id>.json`; its guide and examples live
 * beside it in `packs/<id>/`, so removing the pack removes them and exporting it carries
 * them. A guide is written for a channel, not for one project, so it is edited on the pack.
 */

const styleFile = (id: string) => path.join(packFolder(id), "STYLE.md");
/** The still an agent opens for an example. A picture is its own still. */
export const exampleStill = (id: string, example: PackExample) =>
  path.join(packFolder(id), example.kind === "video" ? `${example.file}.jpg` : example.file);

async function packRecord(id: string): Promise<InstalledPack> {
  const pack = (await listPacks()).find((p) => p.id === id);
  if (!pack) throw new Error(`No installed pack named ${id}.`);
  return pack;
}

async function writeRecord(pack: InstalledPack) {
  await fs.writeFile(path.join(packsDir(), `${pack.id}.json`), JSON.stringify(InstalledPack.parse(pack), null, 2));
}

export async function readStyle(id: string) {
  const pack = await packRecord(id);
  const text = await fs.readFile(styleFile(id), "utf8").catch(() => "");
  return { pack: pack.id, name: pack.name, text, examples: pack.examples.map((e) => ({ ...e, still: exampleStill(id, e) })) };
}

/** Save the guide. Refused, whole, if it is too long or reads as instructions to the agent. */
export async function saveStyle(id: string, text: string) {
  await packRecord(id);
  const problems = scanStyle(text);
  if (problems.length) throw new Error(styleRefusal(problems));
  await fs.mkdir(packFolder(id), { recursive: true });
  if (text.trim()) await fs.writeFile(styleFile(id), text.trim() + "\n");
  else await fs.rm(styleFile(id), { force: true });
  return readStyle(id);
}

/** Copy a picture or video into the pack's examples, with a sheet of stills for a video. */
export async function addExample(id: string, source: string, details: { title?: string; note?: string } = {}) {
  const pack = await packRecord(id);
  const original = path.resolve(source.replace(/^~(?=\/)/, process.env.HOME ?? "~"));
  const kind = kindFor(original);
  if (kind !== "video" && kind !== "image") throw new Error("An example is a video or a picture.");
  const problems = scanStyle(`${details.title ?? ""}\n${details.note ?? ""}`);
  if (problems.length) throw new Error(styleRefusal(problems));
  const name = path.basename(original).replace(/[^\w.-]+/g, "-").replace(/-+/g, "-").toLowerCase();
  const file = `examples/${name}`;
  await fs.mkdir(path.join(packFolder(id), "examples"), { recursive: true });
  await fs.copyFile(original, path.join(packFolder(id), file));
  const example: PackExample = { file, kind, title: details.title ?? "", note: details.note ?? "" };
  if (kind === "video") await contactSheet(path.join(packFolder(id), file), exampleStill(id, example));
  pack.examples = [...pack.examples.filter((e) => e.file !== file), example];
  await writeRecord(pack);
  return readStyle(id);
}

export async function updateExample(id: string, file: string, details: { title?: string; note?: string }) {
  const pack = await packRecord(id);
  const problems = scanStyle(`${details.title ?? ""}\n${details.note ?? ""}`);
  if (problems.length) throw new Error(styleRefusal(problems));
  if (!pack.examples.some((e) => e.file === file)) throw new Error(`${pack.name} has no example ${file}.`);
  pack.examples = pack.examples.map((e) => (e.file === file ? { ...e, ...details } : e));
  await writeRecord(pack);
  return readStyle(id);
}

export async function removeExample(id: string, file: string) {
  const pack = await packRecord(id);
  const example = pack.examples.find((e) => e.file === file);
  if (!example) throw new Error(`${pack.name} has no example ${file}.`);
  await fs.rm(path.join(packFolder(id), example.file), { force: true });
  if (example.kind === "video") await fs.rm(exampleStill(id, example), { force: true });
  pack.examples = pack.examples.filter((e) => e.file !== file);
  await writeRecord(pack);
  return readStyle(id);
}

// ---------------------------------------------------------------- which guide a video uses

db.exec(`CREATE TABLE IF NOT EXISTS settings (scope TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (scope, key))`);
const CHOICE = "style.pack";

/** A project's own choice: a pack id, `"none"`, or `null` to decide on its own. */
export function styleChoice(projectId: string): string | null {
  const row = db.prepare("SELECT value FROM settings WHERE scope = ? AND key = ?").get(`project:${projectId}`, CHOICE) as { value: string } | undefined;
  return row?.value ?? null;
}

export async function chooseStyle(projectId: string, choice: string | null) {
  if (choice && choice !== "none") await packRecord(choice);
  if (choice === null) db.prepare("DELETE FROM settings WHERE scope = ? AND key = ?").run(`project:${projectId}`, CHOICE);
  else db.prepare("INSERT INTO settings (scope, key, value) VALUES (?, ?, ?) ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value").run(`project:${projectId}`, CHOICE, choice);
  return activeStyle(projectId);
}

/** The templates a video is made in: its own plan's, the project's, then whatever a template wrote into it. */
function templatesOf(projectId: string, sequenceId?: string): string[] {
  let edl;
  try { edl = readEditor(projectId).edl; } catch { return []; }
  const sequences = sequenceId ? edl.sequences.filter((s) => s.id === sequenceId) : edl.sequences;
  const found = new Set<string>();
  for (const sequence of sequences) if (sequence.plan.template) found.add(sequence.plan.template);
  if (edl.plan.template) found.add(edl.plan.template);
  for (const id of edl.plan.templates) found.add(id);
  for (const sequence of sequences) for (const item of sequence.items) for (const edit of item.clip.edits) {
    const marker = /^template:([a-z0-9][a-z0-9-]*)/.exec(edit.by);
    if (marker) found.add(marker[1]);
  }
  return [...found];
}

export type ActiveStyle = {
  pack: string | null;
  name: string;
  text: string;
  examples: Array<PackExample & { still: string }>;
  /** Why this guide, or why none — shown in the panel and handed to the agent. */
  reason: string;
  choice: string | null;
};

/**
 * The guide a project (or one of its videos) is made to. In order: the project's own
 * choice; the pack that owns the template the video is made in; the only installed pack
 * that has a guide. Several packs with guides and nothing to choose between them is none:
 * two voices in one prompt contradict each other.
 */
export async function activeStyle(projectId: string, sequenceId?: string): Promise<ActiveStyle> {
  const choice = styleChoice(projectId);
  const none = (reason: string): ActiveStyle => ({ pack: null, name: "", text: "", examples: [], reason, choice });
  const packs = await listPacks();
  // A pack that only says what correct looks like is still the pack this video answers
  // to: the standard and the guide are two halves of one voice, and `activeCriteria`
  // asks this same question rather than picking a pack of its own.
  const withGuide = async (pack: InstalledPack) =>
    (await fs.stat(styleFile(pack.id)).catch(() => null)) !== null
    || (await fs.stat(path.join(packFolder(pack.id), PACK_REVIEW_FILE)).catch(() => null)) !== null
    || pack.examples.length > 0;
  const use = async (id: string, reason: string): Promise<ActiveStyle> => ({ ...(await readStyle(id)), pack: id, reason, choice });

  if (choice === "none") return none("This project is set to use no style guide.");
  if (choice) {
    if (packs.some((p) => p.id === choice)) return use(choice, "Chosen for this project.");
    return none(`This project chose ${choice}, which is no longer installed.`);
  }
  const templates = templatesOf(projectId, sequenceId);
  for (const template of templates) {
    const owner = packs.find((p) => p.provides.templates.includes(template) || p.templates.includes(template));
    if (owner && (await withGuide(owner))) return use(owner.id, `The video is made in ${template}, from the ${owner.name} pack.`);
  }
  const guided = [];
  for (const pack of packs) if (await withGuide(pack)) guided.push(pack);
  if (guided.length === 1) return use(guided[0].id, `${guided[0].name} is the only installed pack with a style guide.`);
  if (!guided.length) return none("No installed pack has a style guide.");
  return none(`${guided.length} packs have a style guide and nothing says which this project is; choose one.`);
}

/**
 * The guide as a run of an agent sees it: `STYLE.md` and each example's still copied into
 * `style/` in the run's folder — the agent works there and opens files by relative path —
 * and the prompt block that points at them. Empty when no guide applies.
 */
export async function styleForRun(projectId: string, runDir: string, sequenceId?: string): Promise<string> {
  const style = await activeStyle(projectId, sequenceId);
  if (!style.pack) return "";
  const dir = path.join(runDir, "style");
  await fs.mkdir(dir, { recursive: true });
  if (style.text.trim()) await fs.writeFile(path.join(dir, "STYLE.md"), style.text);
  const examples = [];
  for (const example of style.examples) {
    const still = path.join("style", path.basename(example.still));
    await fs.copyFile(example.still, path.join(runDir, still)).catch(() => undefined);
    examples.push({ ...example, still });
  }
  return styleBlock({ packName: style.name, text: style.text, examples });
}

/** A file inside a pack's own folder, or null for anything that would leave it. */
export function packExampleFile(id: string, relative: string): string | null {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id) || !relative) return null;
  const root = packFolder(id);
  const target = path.resolve(root, relative);
  return target.startsWith(root + path.sep) ? target : null;
}
