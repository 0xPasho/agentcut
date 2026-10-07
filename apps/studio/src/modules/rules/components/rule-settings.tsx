"use client";
import { useId, useState } from "react";
import { Button } from "@/common/ui/button";
import { Input } from "@/common/ui/input";
import type { SettingSchema } from "@agentcut/core/modules/rules/types";
import { objectValue, settingLabel, settingSeed, settingShape, withSetting } from "@agentcut/core/modules/rules/lib/rule-form";

/** A patch, not a copy of template defaults: removing a field restores inheritance. */
export function RuleSettings({ schema, value, onChange, label = "Video settings" }: {
  schema: SettingSchema; value: unknown; onChange: (value: unknown) => void; label?: string;
}) {
  const id = useId();
  const [newKey, setNewKey] = useState("");
  const shape = settingShape(schema, value);
  const nullable = (schema.anyOf ?? schema.oneOf)?.some(s => s.type === "null");
  const object = shape.type === "object" || shape.properties || (value !== null && typeof value === "object" && !Array.isArray(value));
  if (object) {
    const record = objectValue(value);
    const properties = shape.properties ?? {};
    const available = Object.keys(properties).filter(key => !(key in record));
    const extra = typeof shape.additionalProperties === "object" ? shape.additionalProperties : {};
    return <fieldset className="min-w-0 space-y-3">
      <legend className="mb-2 text-sm font-medium">{label}</legend>
      {Object.entries(record).map(([key, item]) => <div key={key} className="min-w-0 space-y-2 border-s-2 border-border ps-3">
        <RuleSettings schema={properties[key] ?? extra} value={item} label={settingLabel(key)} onChange={next => onChange(withSetting(value, key, next))} />
        <Button type="button" size="xs" variant="ghost" onClick={() => onChange(withSetting(value, key, undefined))}>Remove {settingLabel(key).toLowerCase()}</Button>
      </div>)}
      {!!available.length && <label className="block space-y-1 text-sm" htmlFor={`${id}-add`}>
        <span id={`${id}-add-label`}>Add a setting to {label.toLowerCase()}</span>
        <select id={`${id}-add`} aria-labelledby={`${id}-add-label`} className="h-10 w-full min-w-0 rounded-lg border border-border bg-background px-2 text-base focus-visible:outline-2 focus-visible:outline-ring sm:text-sm" value="" onChange={e => { const key = e.target.value; if (key) onChange(withSetting(value, key, settingSeed(properties[key]))); }}>
          <option value="">Choose a setting…</option>
          {available.map(key => <option key={key} value={key}>{settingLabel(key)}</option>)}
        </select>
      </label>}
      {!shape.properties && shape.additionalProperties !== false && <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-0 flex-1 space-y-1 text-sm" htmlFor={`${id}-key`}><span>{label === "Settings by aspect ratio" ? "Aspect ratio (for example 9:16)" : "Setting name"}</span><Input id={`${id}-key`} value={newKey} onChange={e => setNewKey(e.target.value)} /></label>
        <Button type="button" variant="outline" size="sm" onClick={() => { const key = newKey.trim(); if (key && !["__proto__", "constructor", "prototype"].includes(key) && !(key in record)) { onChange(withSetting(value, key, settingSeed(extra))); setNewKey(""); } }}>Add setting</Button>
      </div>}
    </fieldset>;
  }
  if (shape.type === "array" || Array.isArray(value)) {
    const items = Array.isArray(value) ? value : [];
    return <fieldset className="min-w-0 space-y-2"><legend className="text-sm font-medium">{label}</legend>
      {items.map((item, index) => <div key={index} className="space-y-2 border-s border-border ps-3">
        <RuleSettings schema={shape.items ?? {}} value={item} label={`${label} ${index + 1}`} onChange={next => onChange(items.map((v, i) => i === index ? next : v))} />
        <Button type="button" size="xs" variant="ghost" onClick={() => onChange(items.filter((_, i) => i !== index))}>Remove {label.toLowerCase()} {index + 1}</Button>
      </div>)}
      <Button type="button" size="sm" variant="outline" onClick={() => onChange([...items, settingSeed(shape.items ?? {})])}>Add {label.toLowerCase()}</Button>
    </fieldset>;
  }
  if (shape.enum || shape.type === "boolean" || typeof value === "boolean" || value === null) {
    let choices = (shape.enum ?? []).map(v => ({ value: String(v), label: settingLabel(String(v)), original: v }));
    if (shape.type === "boolean" || typeof value === "boolean") choices = [{ value: "true", label: "On", original: true }, { value: "false", label: "Off", original: false }];
    return <label className="block space-y-1 text-sm" htmlFor={id}><span id={`${id}-label`}>{label}</span>
      <select id={id} aria-labelledby={`${id}-label`} className="h-10 w-full rounded-lg border border-border bg-background px-2 text-base focus-visible:outline-2 focus-visible:outline-ring sm:text-sm" value={value === null ? "__null" : String(value)} onChange={e => {
        if (e.target.value === "__custom") { onChange(settingSeed({ ...settingShape(schema), default: undefined })); return; }
        onChange(e.target.value === "__null" ? null : choices.find(c => c.value === e.target.value)?.original);
      }}>
        {(nullable || value === null) && <option value="__null">None</option>}
        {choices.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
        {value === null && !choices.length && <option value="__custom">Set a value</option>}
      </select></label>;
  }
  const numeric = shape.type === "number" || shape.type === "integer" || typeof value === "number";
  return <div className="space-y-1"><label className="block space-y-1 text-sm" htmlFor={id}><span>{label}</span>
    <Input id={id} type={numeric ? "number" : "text"} step={shape.type === "integer" ? 1 : "any"} min={shape.minimum} max={shape.maximum} value={String(value ?? "")} onChange={e => onChange(numeric ? (e.target.value === "" ? "" : Number(e.target.value)) : e.target.value)} />
  </label>{nullable && <Button type="button" size="xs" variant="ghost" onClick={() => onChange(null)}>Set to none</Button>}</div>;
}
