import type { Rule, SlotAsset, TemplateOption } from "../types";
import { ruleEffects } from "../lib/rule-form";

export function RuleEffects({ rule, templates, assets = [] }: { rule: Rule & { promptText?: string }; templates: TemplateOption[]; assets?: SlotAsset[] }) {
  const effects = ruleEffects(rule, templates, assets);
  return <ul className="mt-2 list-disc space-y-1 ps-4 text-sm leading-relaxed break-words">{effects.map((effect, i) => <li key={i}>{effect}</li>)}</ul>;
}
