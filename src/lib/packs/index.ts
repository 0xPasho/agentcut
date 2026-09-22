import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { WORKSPACE } from "../config";
import { q } from "../db";
import { LIBRARY, ensureLibrary, kindFor, libraryDirFor, registerAsset, toAbs } from "../assets";
import { listTemplates, saveTemplate, deleteTemplate, templatesDir } from "../templates/registry";
import { VideoTemplate } from "../templates/schema";
import { listRules, saveRule, deleteRule, rulesDir } from "../rules/registry";
import { Rule } from "../rules/schema";
import { readGlossaryLevel, saveGlossary } from "../glossary";
import { InstalledPack, PackManifest, type QuickAction } from "./schema";

/**
 * Packs come in by path or URL and are copied into the workspace with their origin
 * recorded; nothing stays linked to where it came from, so offline rendering keeps
 * working. Everything a pack carries is shown before it is installed, because rules
 * and quick actions are text an agent will read: another person's pack is untrusted
 * until the owner has looked at it.
 */
export const packsDir = () => path.join(WORKSPACE, "packs");

type Source = { kind: "url"; base: string } | { kind: "dir"; base: string };

async function resolveSource(source: string): Promise<Source> {
  if (/^https?:\/\//i.test(source)) return { kind: "url", base: source.replace(/\/pack\.json$/i, "").replace(/\/$/, "") };
  const target = path.resolve(source.replace(/^~(?=\/)/, process.env.HOME ?? "~"));
  const stat = await fs.stat(target).catch(() => null);
  if (!stat) throw new Error(`Not found: ${source}`);
  return { kind: "dir", base: stat.isDirectory() ? target : path.dirname(target) };
}

async function readEntry(source: Source, relative: string): Promise<Buffer> {
  if (source.kind === "dir") {
    const target = path.resolve(source.base, relative);
    if (!target.startsWith(source.base + path.sep)) throw new Error(`Pack entry escapes the pack: ${relative}`);
    return fs.readFile(target);
  }
  if (relative.includes("..")) throw new Error(`Pack entry escapes the pack: ${relative}`);
  const response = await fetch(`${source.base}/${relative.split("/").map(encodeURIComponent).join("/")}`);
  if (!response.ok) throw new Error(`${relative}: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

export type PackPreview = {
  manifest: PackManifest;
  source: string;
  hash: string;
  templates: Array<{ id: string; name: string; description: string; extends?: string; exists: boolean; missingParent?: string }>;
  /** Rules with their full text, because the text is what an agent will be told. */
  rules: Array<{ id: string; name: string; when: string; stage: string; prompt: string; exists: boolean }>;
  assets: Array<{ file: string; kind: string; name: string }>;
  quickActions: QuickAction[];
  /** Always true for anything that did not come from this workspace. */
  untrusted: true;
};

/** Read a pack without installing anything. */
export async function inspectPack(sourceText: string): Promise<PackPreview> {
  const source = await resolveSource(sourceText);
  const raw = await readEntry(source, "pack.json");
  const manifest = PackManifest.parse(JSON.parse(raw.toString("utf8")));
  const hash = createHash("sha256").update(raw).digest("hex");
  const existingTemplates = new Set((await listTemplates()).filter((t) => !t.builtin).map((t) => t.id));
  const existingRules = new Set((await listRules()).map((r) => r.id));
  const templates: PackPreview["templates"] = [];
  for (const id of manifest.templates) {
    const doc = VideoTemplate.pick({ id: true, name: true, description: true, extends: true }).parse(JSON.parse((await readEntry(source, `templates/${id}.json`)).toString("utf8")));
    templates.push({ id: doc.id, name: doc.name, description: doc.description, extends: doc.extends, exists: existingTemplates.has(doc.id) });
  }
  // A template that extends one nobody here has is not an error at install time — it is
  // simply hidden afterwards, which looks like the pack installing nothing. Say it first.
  const here = new Set([...(await listTemplates()).map((t) => t.id), ...templates.map((t) => t.id)]);
  for (const template of templates) {
    if (template.extends && !here.has(template.extends)) template.missingParent = template.extends;
  }
  const rules = [];
  for (const id of manifest.rules) {
    const rule = Rule.parse(JSON.parse((await readEntry(source, `rules/${id}.json`)).toString("utf8")));
    const prompt = rule.then.promptFile ? (await readEntry(source, `rules/${rule.then.promptFile}`)).toString("utf8") : rule.then.prompt ?? "";
    rules.push({ id: rule.id, name: rule.name, when: rule.when, stage: rule.stage, prompt, exists: existingRules.has(rule.id) });
  }
  return { manifest, source: sourceText, hash, templates, rules, assets: manifest.assets.map((a) => ({ file: a.file, kind: a.kind, name: a.name })), quickActions: manifest.quickActions, untrusted: true };
}

/** Copy a pack into the workspace. Existing user templates and rules with the same id are replaced only with `replace`. */
export async function importPack(sourceText: string, options: { replace?: boolean } = {}): Promise<InstalledPack> {
  const preview = await inspectPack(sourceText);
  const source = await resolveSource(sourceText);
  const { manifest } = preview;
  await ensureLibrary();
  // Assets first, so a template or rule that names one finds it under its new id.
  const assetIds: Record<string, string> = {};
  for (const entry of manifest.assets) {
    const bytes = await readEntry(source, entry.file);
    const kind = entry.kind ?? kindFor(entry.file);
    const file = path.join(libraryDirFor(kind), `${manifest.id}-${path.basename(entry.file)}`);
    await fs.writeFile(file, bytes);
    const asset = await registerAsset({ file, kind, scope: "library", name: entry.name, tags: entry.tags, source: `pack:${manifest.id}`, license: entry.license || undefined, attribution: entry.attribution || undefined });
    if (asset.path !== path.relative(WORKSPACE, file)) await fs.rm(file, { force: true });
    if (entry.id) assetIds[entry.id] = asset.id;
  }
  const remap = (text: string) => Object.entries(assetIds).reduce((acc, [from, to]) => acc.split(`"${from}"`).join(`"${to}"`), text);
  const templates: string[] = [];
  for (const id of manifest.templates) {
    const doc = JSON.parse(remap((await readEntry(source, `templates/${id}.json`)).toString("utf8")));
    const exists = preview.templates.find((t) => t.id === id)?.exists;
    if (exists && !options.replace) continue;
    await saveTemplate(doc);
    templates.push(id);
  }
  const rules: string[] = [];
  for (const id of manifest.rules) {
    const doc = Rule.parse(JSON.parse(remap((await readEntry(source, `rules/${id}.json`)).toString("utf8"))));
    const exists = preview.rules.find((r) => r.id === id)?.exists;
    if (exists && !options.replace) continue;
    if (doc.then.promptFile) {
      await fs.mkdir(rulesDir("workspace"), { recursive: true });
      await fs.writeFile(path.join(rulesDir("workspace"), path.basename(doc.then.promptFile)), await readEntry(source, `rules/${doc.then.promptFile}`));
      doc.then.promptFile = path.basename(doc.then.promptFile);
    }
    await saveRule(doc, "workspace");
    rules.push(id);
  }
  const glossary: string[] = [];
  if (manifest.glossary.length) {
    const current = await readGlossaryLevel("workspace");
    const byTerm = new Map(current.terms.map((t) => [t.term.toLowerCase(), t]));
    for (const term of manifest.glossary) if (!byTerm.has(term.term.toLowerCase()) || options.replace) { byTerm.set(term.term.toLowerCase(), term); glossary.push(term.term); }
    await saveGlossary({ terms: [...byTerm.values()] }, "workspace");
  }
  const installed = InstalledPack.parse({
    id: manifest.id, name: manifest.name, version: manifest.version, description: manifest.description, author: manifest.author,
    source: sourceText, hash: preview.hash, installedAt: Date.now(), templates, rules, assets: assetIds, glossary, quickActions: manifest.quickActions,
  });
  await fs.mkdir(packsDir(), { recursive: true });
  await fs.writeFile(path.join(packsDir(), `${manifest.id}.json`), JSON.stringify(installed, null, 2));
  return installed;
}

export async function listPacks(): Promise<InstalledPack[]> {
  const files = await fs.readdir(packsDir()).catch(() => [] as string[]);
  const packs: InstalledPack[] = [];
  for (const name of files.filter((f) => f.endsWith(".json")).sort()) {
    try { packs.push(InstalledPack.parse(JSON.parse(await fs.readFile(path.join(packsDir(), name), "utf8")))); }
    catch (error) { console.error(`Ignoring pack record ${name}: ${(error as Error).message}`); }
  }
  return packs;
}

/** Remove what a pack installed: its templates and rules. Assets stay, because projects may use them. */
export async function removePack(id: string): Promise<{ removed: boolean }> {
  const pack = (await listPacks()).find((p) => p.id === id);
  if (!pack) throw new Error(`No installed pack named ${id}`);
  for (const t of pack.templates) await deleteTemplate(t).catch(() => undefined);
  for (const r of pack.rules) await deleteRule(r, "workspace").catch(() => undefined);
  await fs.rm(path.join(packsDir(), `${id}.json`), { force: true });
  return { removed: true };
}

/** Every quick action installed packs contribute. */
export async function packQuickActions(): Promise<Array<QuickAction & { pack: string }>> {
  return (await listPacks()).flatMap((p) => p.quickActions.map((a) => ({ ...a, pack: p.id })));
}

export type ExportRequest = {
  id: string; name: string; version?: string; description?: string; author?: string;
  templates?: string[]; rules?: string[]; glossary?: boolean; assetIds?: string[]; quickActions?: QuickAction[];
  /** Where to write the pack folder. Defaults to `<workspace>/exports/packs/<id>`. */
  dir?: string;
};

/** Write a pack folder from what is in this workspace. Built-in templates are written out whole. */
export async function exportPack(request: ExportRequest): Promise<{ dir: string; manifest: PackManifest }> {
  const dir = path.resolve(request.dir ?? path.join(WORKSPACE, "exports", "packs", request.id));
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(path.join(dir, "templates"), { recursive: true });
  await fs.mkdir(path.join(dir, "rules"), { recursive: true });
  await fs.mkdir(path.join(dir, "assets"), { recursive: true });
  const templates = await listTemplates();
  const chosenTemplates: string[] = [];
  for (const id of request.templates ?? []) {
    const t = templates.find((x) => x.id === id);
    if (!t) throw new Error(`Template not found: ${id}`);
    const { builtin, file, ...document } = t; void builtin;
    const raw = file ? await fs.readFile(file, "utf8") : JSON.stringify(document, null, 2);
    await fs.writeFile(path.join(dir, "templates", `${id}.json`), raw);
    chosenTemplates.push(id);
  }
  const rules = await listRules();
  const chosenRules: string[] = [];
  for (const id of request.rules ?? []) {
    const r = rules.find((x) => x.id === id);
    if (!r) throw new Error(`Rule not found: ${id}`);
    const { level, file, promptText, ...document } = r; void level; void file; void promptText;
    if (document.then.promptFile) await fs.copyFile(path.join(path.dirname(r.file), document.then.promptFile), path.join(dir, "rules", path.basename(document.then.promptFile)));
    await fs.writeFile(path.join(dir, "rules", `${id}.json`), JSON.stringify(document, null, 2));
    chosenRules.push(id);
  }
  const assets = [];
  for (const id of request.assetIds ?? []) {
    const asset = q.getAsset(id);
    if (!asset) throw new Error(`Asset not found: ${id}`);
    const file = `assets/${asset.id}${path.extname(asset.path)}`;
    await fs.copyFile(toAbs(asset.path), path.join(dir, file));
    assets.push({ file, kind: asset.kind, name: asset.name, tags: asset.tags, license: asset.license ?? "", attribution: asset.attribution ?? "", id: asset.id });
  }
  const manifest = PackManifest.parse({
    id: request.id, name: request.name, version: request.version, description: request.description, author: request.author,
    templates: chosenTemplates, rules: chosenRules, glossary: request.glossary ? (await readGlossaryLevel("workspace")).terms : [], assets, quickActions: request.quickActions ?? [],
  });
  await fs.writeFile(path.join(dir, "pack.json"), JSON.stringify(manifest, null, 2));
  return { dir, manifest };
}

export { LIBRARY, templatesDir };
