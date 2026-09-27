"use client";
import { useId, useRef, useState } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { api } from "@/common/api/client";
import { Button } from "@/common/ui/button";
import { Input } from "@/common/ui/input";
import { Textarea } from "@/common/ui/textarea";
import { Switch } from "@/common/ui/switch";
import { Rule, type RuleDraftReply, type RuleDraftTurn, type RuleLevel, type SlotAsset, type TemplateOption } from "../types";
import { RULE_EXAMPLES, STAGE_LABELS } from "../data";
import { editableRule, newRuleId, ruleEffects, settingsSchema, ruleError } from "../lib/rule-form";
import { CommonRuleSettings } from "./common-rule-settings";
import { RuleSettings } from "./rule-settings";
import { RuleSlots } from "./rule-slots";

export function RuleForm({ initial, isNew, templates, assets, terms = [], projectId, level: initialLevel = "workspace", onSave, onCancel }: {
  initial: Rule; isNew: boolean; templates: TemplateOption[]; assets: SlotAsset[]; terms?: string[]; projectId?: string;
  level?: RuleLevel; onSave: (rule: Rule, level: RuleLevel) => Promise<unknown>; onCancel: () => void;
}) {
  const id = useId();
  const [rule, setRule] = useState<Rule>(() => ({ ...(initial.id ? editableRule(initial) : initial), id: initial.id || newRuleId(initial.name) }));
  const [level, setLevel] = useState<RuleLevel>(initialLevel);
  const [manual, setManual] = useState(!isNew);
  const [agentOpen, setAgentOpen] = useState(isNew);
  const [text, setText] = useState("");
  const [history, setHistory] = useState<RuleDraftTurn[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notices, setNotices] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const previewRef = useRef<HTMLHeadingElement>(null);
  const template = templates.find(t => t.id === rule.then.template);
  const orphanSlots = Object.fromEntries(Object.entries(rule.then.slots ?? {}).filter(([key]) => !template?.slots.some(s => s.id === key)));
  const effects = ruleEffects(rule, templates, assets);
  const change = (patch: Partial<Rule>) => { setSaved(false); setRule(current => ({ ...current, ...patch })); };
  const changeAction = (patch: Partial<Rule["then"]>) => { setSaved(false); setRule(current => ({ ...current, then: { ...current.then, ...patch } })); };
  const fail = (e: unknown) => { setError(ruleError(e)); requestAnimationFrame(() => errorRef.current?.focus()); };

  const ask = async () => {
    if (!text.trim()) { setError("Describe what you want the rule to do."); requestAnimationFrame(() => errorRef.current?.focus()); return; }
    setBusy("draft"); setError(""); setNotices([]); setSaved(false);
    try {
      const request = { text: text.trim(), ...(rule.name.trim() && rule.when.trim() ? { current: rule } : {}), history: history.slice(-18) };
      const reply = projectId
        ? await api.editorTool<RuleDraftReply>(projectId, { tool: "rules.draft", ...request })
        : await api.workspace<RuleDraftReply>({ action: "rules.draft", ...request });
      setHistory([...request.history, { role: "user", text: request.text }, { role: "assistant", text: reply.message }]);
      setText("");
      if (reply.rule) {
        setRule({ ...reply.rule, id: rule.id }); setManual(true); setAgentOpen(false);
        requestAnimationFrame(() => previewRef.current?.focus());
      }
    } catch (e) { fail(e); }
    finally { setBusy(""); }
  };

  const save = async () => {
    setError(""); setNotices([]);
    const next = { ...rule, subject: rule.subject?.trim() || undefined, then: { ...rule.then } };
    if (!Object.keys(next.then.overrides ?? {}).length) delete next.then.overrides;
    if (!Object.keys(next.then.slots ?? {}).length) delete next.then.slots;
    if (!next.then.prompt?.trim()) delete next.then.prompt;
    try {
      const parsed = Rule.parse(next);
      if (!parsed.name.trim() || !parsed.when.trim()) throw new Error("Add a rule name and explain when it should apply.");
      setBusy("save");
      const result = await onSave(parsed, level) as { warnings?: string[] } | undefined;
      const warnings = result?.warnings ?? [];
      if (warnings.length) { setNotices(warnings); setSaved(true); return; }
      onCancel();
    } catch (e) { fail(e); }
    finally { setBusy(""); }
  };

  return <section className="min-w-0 space-y-6">
    <div className="space-y-2">
      <Button type="button" size="sm" variant="ghost" className="-ms-2" disabled={busy === "save"} onClick={onCancel}><ArrowLeft />Back to rules</Button>
      <h2 className="text-2xl font-semibold tracking-tight">{isNew ? "Create a rule" : "Edit rule"}</h2>
      <p className="max-w-prose text-sm text-muted-foreground">Describe what you want to happen. Review the draft, then save it for future edits.</p>
    </div>

    <details open={agentOpen} onToggle={e => setAgentOpen(e.currentTarget.open)} className="min-w-0 space-y-4 rounded-2xl border border-border bg-card p-4 sm:p-5">
      <summary className="cursor-pointer font-medium">{manual ? "Ask the agent to help with this rule" : "Create with the agent"}</summary>
      <p className="text-sm text-muted-foreground">The agent can turn an idea into a rule or help change this draft. It uses your configured agent and model.</p>
      {!!history.length && <div className="max-h-64 space-y-3 overflow-y-auto break-words rounded-xl bg-background/50 p-3" aria-label="Rule conversation">
        {history.map((turn, i) => <p key={i} className="whitespace-pre-wrap text-sm"><span className="font-medium">{turn.role === "user" ? "You: " : "Agent: "}</span>{turn.text}</p>)}
      </div>}
      <label className="block space-y-2 text-sm font-medium" htmlFor={`${id}-idea`}>
        <span>{history.length ? "What would you like to change or clarify?" : "What should the rule do?"}</span>
        <Textarea id={`${id}-idea`} rows={3} disabled={!!busy} value={text} onChange={e => setText(e.target.value)} placeholder="For gameplay clips, keep the game visible without added pictures." />
      </label>
      {!history.length && !manual && <div className="flex flex-col items-start gap-1">
        <p className="text-xs text-muted-foreground">Try an example</p>
        {RULE_EXAMPLES.map(example => <Button key={example} type="button" variant="ghost" size="sm" disabled={!!busy} className="h-auto max-w-full justify-start whitespace-normal py-2 text-start font-normal" onClick={() => setText(example)}>{example}</Button>)}
      </div>}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant={manual ? "outline" : "default"} disabled={!!busy} onClick={() => void ask()}>{busy === "draft" && <Loader2 aria-hidden className="motion-safe:animate-spin" />}{history.length ? "Update draft" : "Draft rule"}</Button>
        {!manual && <Button type="button" variant="ghost" disabled={!!busy} onClick={() => { setManual(true); setAgentOpen(false); }}>Create manually</Button>}
      </div>
      <p role="status" className="text-xs text-muted-foreground">{busy === "draft" ? "The agent is preparing a proposal. Nothing has been saved. This can take a minute." : "Nothing is saved until you choose Save rule."}</p>
    </details>

    <p ref={errorRef} tabIndex={-1} role={error ? "alert" : undefined} className={error ? "whitespace-pre-wrap rounded-lg border border-destructive/40 p-3 text-sm text-destructive" : "hidden"}>{error}</p>
    {notices.length > 0 && <div role="status" className="space-y-2 rounded-lg border border-border p-3 text-sm"><p className="font-medium">Saved with notes</p>{notices.map(note => <p key={note}>{note}</p>)}</div>}

    {manual && <form className="min-w-0 space-y-5" onSubmit={e => { e.preventDefault(); void save(); }}>
      <fieldset disabled={!!busy} className="min-w-0 space-y-5">
        <div className="space-y-3 rounded-2xl border border-border p-4 sm:p-5">
          <h3 ref={previewRef} tabIndex={-1} className="font-medium">Review your rule</h3>
          <p className="text-sm"><span className="font-medium">When: </span>{rule.when || "Describe when this rule should apply below."}</p>
          <ul className="list-disc space-y-1 ps-5 text-sm break-words">{effects.map((effect, i) => <li key={i}>{effect}</li>)}</ul>
          <p className="text-sm text-muted-foreground">{level === "workspace" ? "Applies to every project." : "Applies only to this project."} {rule.enabled ? "Enabled for future runs." : "Paused; it will not apply."} Existing videos keep their current edits.</p>
        </div>
        <div className="space-y-4">
          <label className="block space-y-1.5 text-sm font-medium" htmlFor={`${id}-when`}><span>When should it apply?</span><Textarea id={`${id}-when`} required value={rule.when} onChange={e => change({ when: e.target.value })} placeholder="The clip shows gameplay footage" /></label>
          <label className="block space-y-1.5 text-sm font-medium" htmlFor={`${id}-name`}><span>Rule name</span><Input id={`${id}-name`} required value={rule.name} onChange={e => change({ name: e.target.value })} placeholder="Keep gameplay visible" /></label>
          <label className="block space-y-1.5 text-sm" htmlFor={`${id}-stage`}><span className="font-medium">Use this rule when</span>
            <select id={`${id}-stage`} className="h-10 w-full rounded-lg border border-border bg-background px-2 text-base focus-visible:outline-2 focus-visible:outline-ring sm:text-sm" value={rule.stage} onChange={e => change({ stage: e.target.value as Rule["stage"] })}>
              {Object.entries(STAGE_LABELS).map(([key, label]) => <option key={key} value={key}>{key === "both" ? "Choosing and editing clips" : label}</option>)}
            </select></label>
          {projectId && <label className="block space-y-1.5 text-sm" htmlFor={`${id}-scope`}><span className="font-medium">Where it applies</span>
            <select id={`${id}-scope`} disabled={!isNew} className="h-10 w-full rounded-lg border border-border bg-background px-2 text-base focus-visible:outline-2 focus-visible:outline-ring sm:text-sm" value={level} onChange={e => setLevel(e.target.value as RuleLevel)}><option value="workspace">Every project</option><option value="project">This project only</option></select>
          </label>}
        </div>
        {rule.stage === "select" && <p className="text-sm text-muted-foreground">Choosing clips uses the instruction below. Video settings apply during editing; choose “Editing” or “Choosing and editing clips” to use them.</p>}
        <details open={rule.stage !== "select"} className="min-w-0 space-y-4 rounded-2xl border border-border p-4 sm:p-5">
          <summary className="cursor-pointer font-medium">Automatic video settings</summary>
          <p className="text-sm text-muted-foreground">These settings take effect when the rule is applied in the editor or an editing run. Remove a setting to use the template&apos;s value.</p>
          <label className="block space-y-1.5 text-sm" htmlFor={`${id}-template`}><span className="font-medium">Template</span>
            <select id={`${id}-template`} className="h-10 w-full rounded-lg border border-border bg-background px-2 text-base focus-visible:outline-2 focus-visible:outline-ring sm:text-sm" value={rule.then.template ?? ""} onChange={e => changeAction({ template: e.target.value || undefined })}>
              <option value="">Keep the video&apos;s template</option>
              {rule.then.template && !template && <option value={rule.then.template}>{rule.then.template} (not installed)</option>}
              {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select></label>
          <RuleSlots slots={template?.slots ?? []} assets={assets} value={rule.then.slots ?? {}} onChange={slots => changeAction({ slots })} />
          {!!Object.keys(orphanSlots).length && <div className="space-y-2"><p className="text-sm text-muted-foreground">These inputs are not offered by the selected template. Choose their template or remove them.</p><RuleSettings schema={{ type: "object", additionalProperties: false }} label="Other template inputs" value={orphanSlots} onChange={value => changeAction({ slots: { ...Object.fromEntries(Object.entries(rule.then.slots ?? {}).filter(([key]) => !(key in orphanSlots))), ...value as Rule["then"]["slots"] } })} /></div>}
          <CommonRuleSettings value={rule.then.overrides ?? {}} onChange={overrides => changeAction({ overrides })} />
          <details className="min-w-0 space-y-3"><summary className="cursor-pointer text-sm font-medium">All video settings</summary><RuleSettings schema={settingsSchema()} value={rule.then.overrides ?? {}} onChange={overrides => changeAction({ overrides: overrides as Record<string, unknown> })} /></details>
        </details>
        <div className="space-y-2">
          <label className="block space-y-1.5 text-sm font-medium" htmlFor={`${id}-instruction`}><span>Instruction for the agent</span><Textarea id={`${id}-instruction`} rows={3} value={rule.then.prompt ?? ""} onChange={e => changeAction({ prompt: e.target.value })} placeholder="Keep the full game interface visible when choosing a crop." aria-describedby={`${id}-instruction-help`} /></label>
          <p id={`${id}-instruction-help`} className="text-sm text-muted-foreground">Guidance for the agent when this rule matches. An instruction alone does not change the timeline automatically.</p>
        </div>
        <details className="space-y-3"><summary className="cursor-pointer text-sm font-medium">More options</summary>
          <label className="block space-y-1 text-sm" htmlFor={`${id}-note`}><span>Note to yourself</span><Input id={`${id}-note`} value={rule.description} onChange={e => change({ description: e.target.value })} /></label>
          <label className="block space-y-1 text-sm" htmlFor={`${id}-subject`}><span>Subject (optional)</span><Input id={`${id}-subject`} list={`${id}-subjects`} value={rule.subject ?? ""} onChange={e => change({ subject: e.target.value })} placeholder="Any subject" /><datalist id={`${id}-subjects`}>{terms.map(term => <option key={term} value={term} />)}</datalist></label>
          <label className="block space-y-1 text-sm" htmlFor={`${id}-priority`}><span>Order (lower numbers run first)</span><Input id={`${id}-priority`} type="number" step={1} required value={rule.priority} onChange={e => change({ priority: Number(e.target.value) })} /></label>
        </details>
        <Switch checked={rule.enabled} about={rule.name || "this rule"} label="Enable rule" onCheckedChange={enabled => change({ enabled })} />
        <div className="flex flex-wrap gap-2"><Button type="submit">{busy === "save" && <Loader2 aria-hidden className="motion-safe:animate-spin" />}{saved ? "Save changes" : "Save rule"}</Button><Button type="button" variant="ghost" onClick={onCancel}>{saved ? "Done" : "Cancel"}</Button></div>
      </fieldset>
    </form>}
  </section>;
}
