import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { WORKSPACE, projectDir } from "../../../common/server/config";
import { Rule, RuleLevel, type RuleRecord } from "../types";

/**
 * Rules are files, like templates. `<workspace>/rules/*.json` applies to every
 * project; `<project>/rules/*.json` applies to one and overrides a workspace rule
 * with the same id. The agent and the panel read and write the same folders
 * through these functions.
 */
export const rulesDir = (level: RuleLevel, projectId?: string) => {
  if (level === "project") {
    if (!projectId) throw new Error("A project rule needs a project");
    return path.join(projectDir(projectId), "rules");
  }
  return path.join(WORKSPACE, "rules");
};

async function readDir(level: RuleLevel, projectId?: string): Promise<RuleRecord[]> {
  const dir = rulesDir(level, projectId);
  const files = await fs.readdir(dir).catch(() => [] as string[]);
  const records: RuleRecord[] = [];
  for (const name of files.filter((f) => f.endsWith(".json")).sort()) {
    const file = path.join(dir, name);
    try {
      const rule = Rule.parse(JSON.parse(await fs.readFile(file, "utf8")));
      let promptText = rule.then.prompt ?? "";
      if (rule.then.promptFile) promptText = await fs.readFile(promptFilePath(dir, rule.then.promptFile), "utf8");
      records.push({ ...rule, level, file, promptText });
    } catch (error) {
      // One malformed file must not hide every other rule.
      console.error(`Ignoring invalid rule ${name}: ${(error as Error).message}`);
    }
  }
  return records;
}

/** Every rule that applies to this project, project level winning by id, sorted by priority. */
export async function listRules(projectId?: string): Promise<RuleRecord[]> {
  const workspace = await readDir("workspace");
  const project = projectId ? await readDir("project", projectId) : [];
  const overridden = new Set(project.map((r) => r.id));
  const all = [...workspace.filter((r) => !overridden.has(r.id)), ...project];
  return all.sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
}

export async function getRule(id: string, projectId?: string): Promise<RuleRecord> {
  const found = (await listRules(projectId)).find((r) => r.id === id);
  if (!found) throw new Error(`Rule not found: ${id}. Use rules.list to see what exists.`);
  return found;
}

/** A prompt file must sit inside the rules folder: a rule is not a way to read arbitrary files. */
function promptFilePath(dir: string, promptFile: string): string {
  const target = path.resolve(dir, promptFile);
  if (!target.startsWith(dir + path.sep)) throw new Error("promptFile must be inside the rules folder");
  return target;
}

/**
 * The ways a rule can be written that the schema allows and the app then ignores.
 *
 * Each of these was silent. A rule whose `promptFile` is not there was written, dropped
 * from the list on the next read with a line on the console, and the save that wrote it
 * then failed with "Rule not found" — the author's rule had vanished and the error
 * blamed something else. A rule that applies a template at the `select` stage saved
 * happily and did nothing, because a template is applied to clips that do not exist
 * until selection has run. Both are refused here, where somebody is looking at what
 * they wrote, rather than on the next read of a folder.
 */
async function checkRule(rule: Rule, dir: string): Promise<void> {
  if (rule.then.promptFile) {
    const file = promptFilePath(dir, rule.then.promptFile);
    const found = await fs.stat(file).then(() => true).catch(() => false);
    if (!found) throw new Error(`Rule ${rule.id} reads its prompt from ${rule.then.promptFile}, which is not in the rules folder. Put the file there first, or write the text in "prompt".`);
  }
  const acts = rule.then.template || rule.then.overrides || rule.then.slots;
  if (rule.stage === "select" && acts)
    throw new Error(`Rule ${rule.id} runs at the select stage, where there are no clips yet to apply a template to. Give it stage "edit" or "both", or leave it a prompt for the selection.`);
}

export async function saveRule(input: unknown, level: RuleLevel = "workspace", projectId?: string): Promise<RuleRecord> {
  const rule = Rule.parse(input);
  const dir = rulesDir(level, projectId);
  if (rule.then.promptFile) promptFilePath(dir, rule.then.promptFile);
  await checkRule(rule, dir);
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${rule.id}.json`);
  const temp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temp, JSON.stringify(rule, null, 2));
  await fs.rename(temp, file);
  const saved = await getRule(rule.id, level === "project" ? projectId : undefined);
  const warnings = await doubts(rule);
  return warnings.length ? { ...saved, warnings } : saved;
}

/**
 * What a rule names that its template has not got. A typo in an override section or a
 * slot id is silent otherwise: the merge drops an unknown key and the end card the rule
 * was written to add simply never arrives. Only checked when the template is already
 * here — a rule can legitimately arrive before the pack that carries its template.
 */
async function doubts(rule: Rule): Promise<string[]> {
  const warnings: string[] = [];
  // A rule with nothing in `then` is still a judgement: it lands in the match list and
  // gives the video a tag. It is worth a word all the same, because "end every clip on
  // my card" written with an empty action looks exactly like a rule that works.
  if (!rule.then.template && !rule.then.overrides && !rule.then.slots && !rule.then.prompt?.trim() && !rule.then.promptFile)
    warnings.push(`Rule ${rule.id} judges but does not act: it has no template to apply, no override, no slot to fill and no prompt. It will match videos and change nothing.`);
  if (!rule.then.template) return warnings;
  const { getTemplate } = await import("../../templates/server/registry");
  const template = await getTemplate(rule.then.template).catch(() => null);
  if (!template) return warnings;
  const sections = new Set(Object.keys(template));
  for (const key of Object.keys(rule.then.overrides ?? {})) {
    if (!sections.has(key)) warnings.push(`${template.id} has no “${key}” to override, so that part of the rule does nothing. It has ${[...sections].slice(0, 8).join(", ")}…`);
  }
  const slots = new Set(template.slots.map((slot) => slot.id));
  for (const id of Object.keys(rule.then.slots ?? {})) {
    if (!slots.has(id)) warnings.push(`${template.id} has no slot called “${id}”, so what the rule puts there is never used. It asks for ${slots.size ? [...slots].join(", ") : "no slots at all"}.`);
  }
  return warnings;
}

export async function deleteRule(id: string, level: RuleLevel = "workspace", projectId?: string): Promise<{ deleted: boolean }> {
  const file = path.join(rulesDir(level, projectId), `${path.basename(id)}.json`);
  try { await fs.unlink(file); return { deleted: true }; }
  catch { throw new Error(`No ${level} rule named ${id}.`); }
}

export const ruleSchema = () => z.toJSONSchema(Rule, { io: "input" });
