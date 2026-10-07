"use client";
import { useId } from "react";
import { COMMON_RULE_SETTINGS } from "@agentcut/core/modules/rules/data";
import { changeSetting, settingAt, settingChoiceLabel, settingsSchema, settingShape } from "@agentcut/core/modules/rules/lib/rule-form";

export function CommonRuleSettings({ value, onChange }: { value: Record<string, unknown>; onChange: (next: Record<string, unknown>) => void }) {
  const id = useId();
  return <div className="grid min-w-0 gap-3 sm:grid-cols-2">{COMMON_RULE_SETTINGS.map(({ path, label }) => {
    const schema = path.reduce((current, key) => settingShape(current).properties?.[key] ?? {}, settingsSchema());
    const shape = settingShape(schema);
    const options = shape.enum ?? [true, false];
    const current = settingAt(value, path);
    const fieldId = `${id}-${path.join("-")}`;
    return <label key={fieldId} htmlFor={fieldId} className="min-w-0 space-y-1 text-sm"><span id={`${fieldId}-label`}>{label}</span>
      <select id={fieldId} aria-labelledby={`${fieldId}-label`} className="h-10 w-full min-w-0 rounded-lg border border-border bg-background px-2 text-base focus-visible:outline-2 focus-visible:outline-ring sm:text-sm" value={current === undefined ? "inherit" : String(current)} onChange={e => onChange(changeSetting(value, path, e.target.value === "inherit" ? undefined : options.find(o => String(o) === e.target.value)))}>
        <option value="inherit">Use template setting</option>
        {options.map(option => <option key={String(option)} value={String(option)}>{settingChoiceLabel(option)}</option>)}
      </select>
    </label>;
  })}</div>;
}
