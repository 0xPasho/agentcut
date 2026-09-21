import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { WORKSPACE, projectDir } from "../config";
import { Rule, RuleLevel, type RuleRecord } from "./schema";

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

export async function saveRule(input: unknown, level: RuleLevel = "workspace", projectId?: string): Promise<RuleRecord> {
  const rule = Rule.parse(input);
  const dir = rulesDir(level, projectId);
  if (rule.then.promptFile) promptFilePath(dir, rule.then.promptFile);
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${rule.id}.json`);
  const temp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temp, JSON.stringify(rule, null, 2));
  await fs.rename(temp, file);
  return getRule(rule.id, level === "project" ? projectId : undefined);
}

export async function deleteRule(id: string, level: RuleLevel = "workspace", projectId?: string): Promise<{ deleted: boolean }> {
  const file = path.join(rulesDir(level, projectId), `${path.basename(id)}.json`);
  try { await fs.unlink(file); return { deleted: true }; }
  catch { throw new Error(`No ${level} rule named ${id}.`); }
}

export const ruleSchema = () => z.toJSONSchema(Rule, { io: "input" });
