import { z } from "zod";
import { VideoTemplate } from "../../templates/types";
import { Rule, type RuleRecord, type SettingSchema, type SlotAsset, type TemplateOption } from "../types";
import { SETTING_LABELS } from "../data";

export function settingsSchema(): SettingSchema {
  const schema = z.toJSONSchema(VideoTemplate.omit({ id: true, schema: true, name: true, description: true, author: true, extends: true, tags: true }), { io: "input" }) as SettingSchema;
  // An aspect variant is another template patch, so it uses the same field controls.
  const { variants, ...properties } = schema.properties ?? {};
  if (variants) schema.properties!.variants = { ...variants, additionalProperties: { type: "object", properties } };
  return schema;
}

export function settingLabel(key: string): string {
  return SETTING_LABELS[key] ?? key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]/g, " ").replace(/^./, c => c.toUpperCase());
}

export function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function settingShape(schema: SettingSchema, value?: unknown): SettingSchema {
  const choices = schema.anyOf ?? schema.oneOf;
  if (!choices) return schema;
  const match = choices.find(c => c.type === typeof value || (value === null && c.type === "null") || (Array.isArray(value) && c.type === "array"));
  return { ...schema, ...(match ?? choices.find(c => c.type !== "null") ?? choices[0]), anyOf: undefined, oneOf: undefined };
}

export function settingSeed(schema: SettingSchema): unknown {
  const shape = settingShape(schema);
  if (shape.type === "object" || shape.properties) return {};
  if (schema.default !== undefined) return structuredClone(schema.default);
  if (shape.const !== undefined) return shape.const;
  if (shape.enum) return shape.enum[0];
  if (shape.type === "object" || shape.properties) return {};
  if (shape.type === "array") return [];
  if (shape.type === "boolean") return false;
  if (shape.type === "null") return null;
  if (shape.type === "number" || shape.type === "integer") return shape.minimum ?? (shape.exclusiveMinimum !== undefined ? shape.exclusiveMinimum + 1 : 0);
  return "";
}

export function withSetting(value: unknown, key: string, next: unknown): Record<string, unknown> {
  const copy = { ...objectValue(value) };
  if (next === undefined) delete copy[key]; else copy[key] = next;
  return copy;
}

/** Materialize file-backed instructions so the same visible text is editable in either interface. */
export function editableRule(record: Rule | RuleRecord): Rule {
  const parsed = Rule.parse(Object.fromEntries(Object.entries(record).filter(([key]) => key in Rule.shape)));
  if ("promptText" in record && parsed.then.promptFile) {
    const { promptFile, ...action } = parsed.then;
    void promptFile;
    parsed.then = { ...action, prompt: record.promptText };
  }
  return parsed;
}

export function newRuleId(name: string): string {
  const slug = name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `${slug.slice(0, 55) || "rule"}-${crypto.randomUUID().slice(0, 8)}`;
}

export function settingLines(value: unknown, prefix = ""): string[] {
  if (Array.isArray(value)) return value.flatMap((item, i) => settingLines(item, `${prefix} ${i + 1}`));
  if (value && typeof value === "object") return Object.entries(value).flatMap(([key, item]) => settingLines(item, [prefix, settingLabel(key)].filter(Boolean).join(" · ")));
  let text = String(value ?? "None");
  if (typeof value === "boolean") text = value ? "On" : "Off";
  if (typeof value === "string") text = SETTING_LABELS[value] ?? value;
  return [`${prefix}: ${text}`];
}

export function ruleEffects(rule: Rule & { promptText?: string }, templates: Pick<TemplateOption, "id" | "name" | "slots">[], assets: SlotAsset[] = []): string[] {
  const template = templates.find(t => t.id === rule.then.template);
  const lines: string[] = [];
  if (rule.then.template) lines.push(`Use ${template?.name ?? rule.then.template}`);
  lines.push(...settingLines(rule.then.overrides ?? {}));
  for (const [key, slot] of Object.entries(rule.then.slots ?? {})) {
    const names = slot.assetIds?.map(id => assets.find(a => a.id === id)?.name ?? id).join(", ");
    const value = names || (slot.assetId ? assets.find(a => a.id === slot.assetId)?.name ?? slot.assetId : slot.text ?? slot.folder ?? "No file selected");
    lines.push(`${template?.slots.find(s => s.id === key)?.label ?? settingLabel(key)}: ${value}`);
  }
  const prompt = rule.promptText ?? rule.then.prompt;
  if (prompt) lines.push(`Agent instruction: ${prompt}`);
  else if (rule.then.promptFile) lines.push(`Agent instruction from ${rule.then.promptFile}`);
  return lines.length ? lines : ["Matches videos only; no editing action configured."];
}

export function settingAt(value: unknown, path: readonly string[]): unknown {
  return path.reduce<unknown>((current, key) => objectValue(current)[key], value);
}

export function changeSetting(value: unknown, path: readonly string[], next: unknown): Record<string, unknown> {
  const [key, ...rest] = path;
  if (!rest.length) return withSetting(value, key, next);
  const child = changeSetting(objectValue(value)[key], rest, next);
  return withSetting(value, key, Object.keys(child).length ? child : undefined);
}

/** Validation messages name the field and correction, never expose a JSON error document. */
export function ruleError(error: unknown): string {
  if (error instanceof z.ZodError) return error.issues.map(issue => `${issue.path.map(part => settingLabel(String(part))).join(" · ") || "Rule"}: ${issue.message}`).join("\n");
  return error instanceof Error ? error.message : String(error);
}

export function settingChoiceLabel(value: unknown): string {
  if (typeof value === "boolean") return value ? "On" : "Off";
  return settingLabel(String(value));
}
