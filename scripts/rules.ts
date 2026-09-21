/** Headless access to the SAME rules, glossary and preferences as the panel and the agent tools. */
import { executeEditorTool } from "../src/lib/editor/tools";
import { listRules, getRule } from "../src/lib/rules/registry";
import { readGlossary } from "../src/lib/glossary";
import { readPreferences } from "../src/lib/preferences";

const USAGE = `usage:
  rules list [projectId]
  rules show <ruleId> [projectId]
  rules evaluate <projectId> [--sequence ID] [--stage select|edit]
  rules apply <projectId> <ruleId,ruleId> [--sequence ID] [--template ID]
  rules glossary [projectId]
  rules preferences [projectId]`;

function flags(rest: string[]) {
  const out: Record<string, string> = {};
  for (let i = 0; i < rest.length; i++) {
    if (!rest[i].startsWith("--")) continue;
    const value = rest[i + 1];
    if (value === undefined) throw new Error(`${rest[i]} needs a value\n\n${USAGE}`);
    out[rest[i].slice(2)] = value; i++;
  }
  return out;
}

async function main() {
  const [mode, ...rest] = process.argv.slice(2);
  if (!mode || mode === "list") {
    for (const r of await listRules(rest[0]))
      console.log(`${r.id.padEnd(22)} ${r.level.padEnd(9)} ${r.stage.padEnd(6)} p${String(r.priority).padEnd(4)} ${r.enabled ? "" : "(off) "}${r.name} — when ${r.when}`);
    return;
  }
  if (mode === "show") { if (!rest[0]) throw new Error(USAGE); console.log(JSON.stringify(await getRule(rest[0], rest[1]), null, 2)); return; }
  if (mode === "glossary") { console.log(JSON.stringify(await readGlossary(rest[0]), null, 2)); return; }
  if (mode === "preferences") { console.log(JSON.stringify(await readPreferences(rest[0]), null, 2)); return; }
  const [projectId, ...more] = rest;
  if (!projectId) throw new Error(USAGE);
  if (mode === "evaluate") {
    const o = flags(more);
    console.log(JSON.stringify(await executeEditorTool(projectId, { tool: "rules.evaluate", ...(o.sequence ? { sequenceId: o.sequence } : {}), ...(o.stage ? { stage: o.stage } : {}) }), null, 2));
    return;
  }
  if (mode === "apply") {
    const ids = (more[0] ?? "").split(",").filter(Boolean);
    if (!ids.length) throw new Error(USAGE);
    const o = flags(more.slice(1));
    const { revision } = await executeEditorTool(projectId, { tool: "project.read" }) as { revision: number };
    console.log(JSON.stringify(await executeEditorTool(projectId, { tool: "rules.apply", ruleIds: ids, expectedRevision: revision, ...(o.sequence ? { sequenceId: o.sequence } : {}), ...(o.template ? { templateId: o.template } : {}) }), null, 2));
    return;
  }
  throw new Error(USAGE);
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
