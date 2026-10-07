import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { WORKSPACE } from "../../../common/server/config";
import { q } from "../../../common/server/db";
import { RuleDraftRequest, RuleDraftReply } from "../types";
import type { AgentProvider } from "../../agent/types";
import { resolveProvider } from "../../agent/server/providers";
import { effectiveSelection } from "../../agent/server/selection";
import { AGENT_FILE_TOOLS, AGENT_SANDBOX_TOOLS } from "../../agent/data";
import { listRules, ruleSchema, validateRule } from "./registry";
import { listTemplates } from "../../templates/server/registry";
import { readGlossary } from "./glossary";
import { settingsSchema, editableRule } from "../lib/rule-form";

/** Workspace and project tools share this draft-only agent run. Only rules.save persists. */
export async function draftRule(input: unknown, projectId?: string, runner?: AgentProvider): Promise<RuleDraftReply> {
  const request = RuleDraftRequest.parse(input);
  const [rules, templates, glossary] = await Promise.all([listRules(projectId), listTemplates(), readGlossary(projectId)]);
  const selection = effectiveSelection(projectId, {}, "observations");
  const provider = runner ?? await resolveProvider(selection.provider);
  const dir = path.join(WORKSPACE, "rule-drafts", randomUUID());
  await fs.mkdir(dir, { recursive: true });
  try {
    const assets = (["image", "video", "audio"] as const).flatMap(kind => q.listAssets(kind).filter(a => a.scope === "library").map(a => ({ id: a.id, name: a.name, kind: a.kind })));
    await fs.writeFile(path.join(dir, "context.json"), JSON.stringify({ request, rules: rules.map(editableRule), templates, assets, glossary, ruleSchema: ruleSchema(), settingsSchema: settingsSchema() }));
    await provider.run({
      cwd: dir, model: selection.model, allowedTools: AGENT_FILE_TOOLS, deniedTools: AGENT_SANDBOX_TOOLS,
      prompt: [
        "Help the owner draft ONE video editing rule. Read context.json for their request, conversation, current draft, existing rules, available templates, library assets, glossary and schemas.",
        "Write proposal.json as {rule: <complete rule matching ruleSchema, or null>, message: <plain-language explanation or one necessary question>}. Nothing is being saved or applied. Do not claim otherwise. Write only proposal.json in this directory; do not modify any other files.",
        "If a necessary file or intended behavior is ambiguous, ask a short question with rule:null. Never invent a template, asset, supported setting, or capability. Use real template settings rather than an agent instruction when an executable setting exists. Selection-only rules cannot apply templates, settings or slots.",
        "Preserve all unrelated fields of the current draft, including its id and enabled state. Never use promptFile. For new rules use a unique lowercase id. Conditions should describe when the rule applies; actions describe what happens. For settings use sparse overrides: include only requested fields from settingsSchema. Slots use library assets. Explain scope and any limitation plainly, without JSON, schema field names, or implementation jargon. Reply in the language of the request.",
        "A rule with only a prompt provides guidance to the agent, not an automatic timeline edit. Saving a rule does not modify existing videos. Do not imply a change to a template affects arbitrary hand-placed items.",
        "After writing proposal.json, reply DONE.",
      ].join("\n\n"),
    });
    const raw = await fs.readFile(path.join(dir, "proposal.json"), "utf8").catch(() => null);
    if (!raw) throw new Error("The agent did not return a draft. Try again or create the rule manually.");
    const reply = RuleDraftReply.parse(JSON.parse(raw));
    if (reply.rule) {
      if (reply.rule.then.promptFile) throw new Error("The draft must include its instruction as text.");
      if (request.current) reply.rule.id = request.current.id;
      else if (rules.some(r => r.id === reply.rule!.id)) reply.rule.id += `-${randomUUID().slice(0, 8)}`;
      if (reply.rule.then.template && !templates.some(t => t.id === reply.rule!.then.template)) throw new Error("The agent proposed a template that is not installed. Ask it to use an available template.");
      for (const slot of Object.values(reply.rule.then.slots ?? {})) {
        if ([slot.assetId, ...(slot.assetIds ?? [])].filter(Boolean).some(id => !assets.some(a => a.id === id))) throw new Error("The agent proposed a file that is not in the library. Choose a library file and try again.");
      }
      await validateRule(reply.rule, "workspace", projectId);
    }
    return reply;
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
