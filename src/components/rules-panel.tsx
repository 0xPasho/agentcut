"use client";
import { useCallback, useEffect, useId, useState } from "react";
import { Loader2, Plus, Trash2, Wand2 } from "lucide-react";
import { api } from "@/lib/client";
import type { Rule, RuleRecord, RuleLevel } from "@/lib/rules/schema";
import type { RuleEvaluation } from "@/lib/rules/evaluate";
import type { RuleApplyResult } from "@/lib/rules/apply";
import type { Glossary } from "@/lib/glossary";
import type { Proposals, Observation } from "@/lib/observations";
import type { TemplateSlot } from "@/lib/templates/schema";
import type { AssetSummary } from "@/lib/client";
import { RuleSlots } from "./rule-slots";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Disclosure } from "@/components/ui/disclosure";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Separator } from "./ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";

/**
 * Rules, glossary and preferences for the video you have open: the project level,
 * beside the subject it is about. Every button calls the same project tool an agent
 * calls, so nothing here is a second way to write these files.
 *
 * The workspace level — the rules, names and preferences that apply to every project
 * — has its own home at /settings and its own editors. This panel still reads and
 * writes both levels, because a project rule is edited next to the workspace rules
 * it inherits, and because the workspace route runs exactly the same functions.
 */

type TemplateOption = { id: string; name: string; builtin: boolean; slots: TemplateSlot[] };
type Loaded = { rules: RuleRecord[]; glossary: Glossary; preferences: { workspace: string; project: string }; templates: TemplateOption[]; assets: AssetSummary[]; observations: Observation[] };

const EMPTY_RULE: Rule = { id: "", name: "", description: "", when: "", stage: "both", priority: 100, enabled: true, then: {} };
const STAGE_LABELS: Record<string, string> = { select: "Choosing clips", edit: "Editing", both: "Both" };

export function RulesPanel({ projectId, sequenceId, beforeApply, afterApply }: {
  projectId?: string;
  /** The open video, for judging and applying rules against it. */
  sequenceId?: string;
  beforeApply?: () => Promise<boolean>;
  afterApply?: () => Promise<void>;
}) {
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState("");

  const load = useCallback(async () => {
    try {
      if (projectId) {
        const [rules, glossary, preferences, templates, observations, ...assets] = await Promise.all([
          api.editorTool<RuleRecord[]>(projectId, { tool: "rules.list" }),
          api.editorTool<Glossary>(projectId, { tool: "glossary.get" }),
          api.editorTool<Loaded["preferences"]>(projectId, { tool: "preferences.get" }),
          api.editorTool<TemplateOption[]>(projectId, { tool: "templates.list" }),
          api.editorTool<Observation[]>(projectId, { tool: "observations.read", limit: 40 }),
          // A rule outlives the project it was written in, so only library assets are
          // offered for its slots — a project's own asset is a dangling reference anywhere else.
          ...(["video", "image", "audio"] as const).map((kind) => api.editorTool<AssetSummary[]>(projectId, { tool: "assets.list", kind })),
        ]);
        setData({ rules, glossary, preferences, templates: templates.map((t) => ({ id: t.id, name: t.name, builtin: t.builtin, slots: t.slots })),
          assets: assets.flat().filter((asset) => asset.scope === "library"), observations });
      } else {
        const w = await api.workspace<{ rules: RuleRecord[]; glossary: Glossary; preferences: string; templates: TemplateOption[]; assets: AssetSummary[]; observations: Observation[] }>();
        setData({ rules: w.rules, glossary: w.glossary, preferences: { workspace: w.preferences, project: "" }, templates: w.templates, assets: w.assets ?? [], observations: w.observations });
      }
      setError("");
    } catch (e) { setError((e as Error).message); }
  }, [projectId]);
  useEffect(() => { void load(); }, [load]);

  /** One call, either transport, then reload so the list is what is on disk. */
  const run = async (label: string, call: () => Promise<unknown>) => {
    setPending(label); setError("");
    try { await call(); await load(); }
    catch (e) { setError((e as Error).message); }
    finally { setPending(""); }
  };
  const write = (projectCall: Record<string, unknown>, workspaceBody: Record<string, unknown>) =>
    projectId ? api.editorTool(projectId, projectCall) : api.workspace(workspaceBody);

  if (!data) return <p className="text-xs text-muted-foreground">{error || "Loading…"}</p>;
  return (
    <Tabs defaultValue="rules">
      <TabsList className="w-full">
        <TabsTrigger value="rules" className="flex-1">Rules</TabsTrigger>
        <TabsTrigger value="glossary" className="flex-1">Glossary</TabsTrigger>
        <TabsTrigger value="preferences" className="flex-1">Preferences</TabsTrigger>
      </TabsList>
      <TabsContent value="rules" className="space-y-4 pt-4">
        {projectId && sequenceId && <JudgeAndApply projectId={projectId} sequenceId={sequenceId} rules={data.rules} beforeApply={beforeApply} afterApply={afterApply} onError={setError} />}
        <RuleList rules={data.rules} templates={data.templates} assets={data.assets} canProject={!!projectId} pending={pending}
          onSave={(rule, level) => run(`save:${rule.id}`, () => write({ tool: "rules.save", rule, level }, { action: "rules.save", rule }))}
          onDelete={(rule) => run(`delete:${rule.id}`, () => write({ tool: "rules.delete", id: rule.id, level: rule.level }, { action: "rules.delete", id: rule.id }))} />
      </TabsContent>
      <TabsContent value="glossary" className="pt-4">
        <GlossaryEditor glossary={data.glossary} canProject={!!projectId} pending={pending}
          onSave={(glossary, level) => run("glossary", () => write({ tool: "glossary.save", glossary, level }, { action: "glossary.save", glossary }))} />
      </TabsContent>
      <TabsContent value="preferences" className="space-y-4 pt-4">
        <PreferencesEditor label={projectId ? "In general (every project)" : "How you like your videos"} text={data.preferences.workspace} pending={pending === "prefs:workspace"}
          onSave={(text) => run("prefs:workspace", () => write({ tool: "preferences.set", text, level: "workspace" }, { action: "preferences.set", text }))} />
        {projectId && <PreferencesEditor label="For this project" text={data.preferences.project} pending={pending === "prefs:project"}
          onSave={(text) => run("prefs:project", () => api.editorTool(projectId, { tool: "preferences.set", text, level: "project" }))} />}
        <Separator />
        <Review observations={data.observations} glossary={data.glossary} preferences={data.preferences.workspace} pending={pending}
          review={() => projectId ? api.editorTool<Proposals>(projectId, { tool: "observations.review" }) : api.workspace<Proposals>({ action: "observations.review" })}
          onAcceptRule={(rule) => run(`save:${rule.id}`, () => write({ tool: "rules.save", rule, level: "workspace" }, { action: "rules.save", rule }))}
          onAcceptGlossary={(glossary) => run("glossary", () => write({ tool: "glossary.save", glossary, level: "workspace" }, { action: "glossary.save", glossary }))}
          onAcceptPreferences={(text) => run("prefs:workspace", () => write({ tool: "preferences.set", text, level: "workspace" }, { action: "preferences.set", text }))} />
      </TabsContent>
      {error && <p role="alert" className="pt-3 text-sm text-destructive">{error}</p>}
    </Tabs>
  );
}

function JudgeAndApply({ projectId, sequenceId, rules, beforeApply, afterApply, onError }: {
  projectId: string; sequenceId: string; rules: RuleRecord[];
  beforeApply?: () => Promise<boolean>; afterApply?: () => Promise<void>; onError: (m: string) => void;
}) {
  const [evaluation, setEvaluation] = useState<RuleEvaluation | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState("");
  const [result, setResult] = useState("");
  const candidates = rules.filter((r) => r.enabled && r.stage !== "select");
  if (!candidates.length) return <p className="text-xs text-muted-foreground">No editing rules yet. Add one below and it applies to this video and every other.</p>;

  const judge = async () => {
    setBusy("judge"); onError(""); setResult("");
    try {
      const found = await api.editorTool<RuleEvaluation>(projectId, { tool: "rules.evaluate", sequenceId, stage: "edit" });
      setEvaluation(found); setChecked(new Set(found.matches.map((m) => m.id)));
    } catch (e) { onError((e as Error).message); }
    finally { setBusy(""); }
  };
  const apply = async () => {
    setBusy("apply"); onError(""); setResult("");
    try {
      if (beforeApply && !(await beforeApply())) return;
      const current = await api.getProject(projectId);
      const applied = await api.editorTool<RuleApplyResult>(projectId, { tool: "rules.apply", ruleIds: [...checked], sequenceId, expectedRevision: current.revision });
      setResult(applied.applied
        ? `Applied ${applied.templateId} (${applied.templateFrom}) with ${applied.applied.images} picture${applied.applied.images === 1 ? "" : "s"}.`
        : `These rules only add instructions for the agent; the timeline is unchanged.`);
      await afterApply?.();
    } catch (e) { onError((e as Error).message); }
    finally { setBusy(""); }
  };
  return (
    <div className="space-y-3 rounded-xl border border-border p-3">
      <div className="flex items-center gap-2">
        <p className="flex-1 text-sm font-medium">This video</p>
        <Button size="xs" variant="outline" disabled={!!busy} onClick={judge}>{busy === "judge" ? <Loader2 className="motion-safe:animate-spin" /> : <Wand2 />}Which rules hold?</Button>
      </div>
      <ul className="space-y-1.5">
        {candidates.map((r) => {
          const match = evaluation?.matches.find((m) => m.id === r.id);
          return <li key={r.id} className="text-sm">
            <Checkbox className="w-full items-start gap-2" boxClassName="mt-1" checked={checked.has(r.id)}
              onCheckedChange={(on) => { const next = new Set(checked); if (on) next.add(r.id); else next.delete(r.id); setChecked(next); }}>
              <span className="font-medium">{r.name}</span>
              {match && <span className="block text-xs text-muted-foreground">{match.reason || "holds for this video"}</span>}
            </Checkbox>
          </li>;
        })}
      </ul>
      {evaluation && !!evaluation.tags.length && <p className="text-xs text-muted-foreground">Seen as: {evaluation.tags.join(", ")}</p>}
      <Button size="sm" disabled={!checked.size || !!busy} onClick={apply}>{busy === "apply" ? <Loader2 className="motion-safe:animate-spin" /> : null}Apply checked rules</Button>
      {result && <p role="status" className="text-xs text-muted-foreground">{result}</p>}
    </div>
  );
}

function RuleList({ rules, templates, assets, canProject, pending, onSave, onDelete }: {
  rules: RuleRecord[]; templates: TemplateOption[]; assets: AssetSummary[]; canProject: boolean; pending: string;
  onSave: (rule: Rule, level: RuleLevel) => void; onDelete: (rule: RuleRecord) => void;
}) {
  const [editing, setEditing] = useState<{ rule: Rule; level: RuleLevel } | null>(null);
  return (
    <div className="space-y-3">
      <ul className="space-y-2">
        {rules.map((r) => <li key={`${r.level}:${r.id}`} className="rounded-xl border border-border p-3 text-sm">
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate font-medium">{r.name}</span>
            <Badge variant="outline" className="text-[10px]">{r.level}</Badge>
            <Badge variant="secondary" className="text-[10px]">{STAGE_LABELS[r.stage]}</Badge>
            {!r.enabled && <Badge variant="destructive" className="text-[10px]">off</Badge>}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">When {r.when}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {[r.then.template && `template ${r.then.template}`, r.then.overrides && "overrides",
              r.then.slots && `${Object.keys(r.then.slots).length} input${Object.keys(r.then.slots).length === 1 ? "" : "s"}`,
              (r.promptText || r.then.prompt) && "instruction"].filter(Boolean).join(" · ") || "no action yet"}
          </p>
          <div className="mt-2 flex gap-2">
            <Button size="xs" variant="outline" onClick={() => setEditing({ rule: stripRecord(r), level: r.level })}>Edit</Button>
            <Button size="xs" variant="ghost" disabled={pending === `delete:${r.id}`} aria-label={`Delete ${r.name}`} onClick={() => onDelete(r)}><Trash2 /></Button>
          </div>
        </li>)}
      </ul>
      {editing
        ? <RuleForm initial={editing.rule} level={editing.level} templates={templates} assets={assets} canProject={canProject} pending={pending.startsWith("save:")}
            onCancel={() => setEditing(null)} onSave={(rule, level) => { onSave(rule, level); setEditing(null); }} />
        : <Button size="sm" variant="outline" onClick={() => setEditing({ rule: EMPTY_RULE, level: "workspace" })}><Plus />New rule</Button>}
    </div>
  );
}

const stripRecord = (r: RuleRecord): Rule => {
  const { level, file, promptText, ...rule } = r; void level; void file; void promptText;
  return rule;
};

function RuleForm({ initial, level: initialLevel, templates, assets, canProject, pending, onSave, onCancel }: {
  initial: Rule; level: RuleLevel; templates: TemplateOption[]; assets: AssetSummary[]; canProject: boolean; pending: boolean;
  onSave: (rule: Rule, level: RuleLevel) => void; onCancel: () => void;
}) {
  const id = useId();
  const [rule, setRule] = useState<Rule>(initial);
  const [level, setLevel] = useState<RuleLevel>(initialLevel);
  const [overrides, setOverrides] = useState(initial.then.overrides ? JSON.stringify(initial.then.overrides, null, 2) : "");
  const [jsonError, setJsonError] = useState("");
  const set = (patch: Partial<Rule>) => setRule({ ...rule, ...patch });
  const setThen = (patch: Partial<Rule["then"]>) => setRule({ ...rule, then: { ...rule.then, ...patch } });
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return (
    <form className="space-y-3 rounded-xl border border-border p-3" onSubmit={(e) => {
      e.preventDefault();
      let parsed: Record<string, unknown> | undefined;
      if (overrides.trim()) {
        try { parsed = JSON.parse(overrides); } catch { setJsonError("Overrides must be JSON, e.g. {\"images\":{\"mode\":\"off\"}}"); return; }
      }
      setJsonError("");
      const then = { ...rule.then, overrides: parsed, template: rule.then.template || undefined,
        slots: Object.keys(rule.then.slots ?? {}).length ? rule.then.slots : undefined,
        prompt: rule.then.prompt?.trim() || undefined };
      onSave({ ...rule, id: rule.id || slug(rule.name), then }, level);
    }}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1"><Label htmlFor={`${id}-name`}>Name</Label><Input id={`${id}-name`} required value={rule.name} onChange={(e) => set({ name: e.target.value, id: initial.id || slug(e.target.value) })} /></div>
        <div className="space-y-1"><Label htmlFor={`${id}-id`}>Id</Label><Input id={`${id}-id`} required pattern="[a-z0-9][a-z0-9\-]*" value={rule.id} disabled={!!initial.id} onChange={(e) => set({ id: e.target.value })} /></div>
      </div>
      <div className="space-y-1"><Label htmlFor={`${id}-when`}>When</Label><Textarea id={`${id}-when`} required value={rule.when} placeholder="the clip is gameplay footage" onChange={(e) => set({ when: e.target.value })} /></div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1"><Label id={`${id}-stage`}>Applies while</Label>
          <Select value={rule.stage} onValueChange={(v) => set({ stage: v as Rule["stage"] })}>
            <SelectTrigger aria-labelledby={`${id}-stage`} className="w-full"><SelectValue>{(v: unknown) => STAGE_LABELS[String(v)]}</SelectValue></SelectTrigger>
            <SelectContent>{Object.entries(STAGE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
          </Select></div>
        <div className="space-y-1"><Label htmlFor={`${id}-priority`}>Priority</Label><Input id={`${id}-priority`} type="number" step={1} value={rule.priority} onChange={(e) => set({ priority: Number(e.target.value) || 0 })} /></div>
        <div className="space-y-1"><Label id={`${id}-level`}>Saved for</Label>
          <Select value={level} onValueChange={(v) => setLevel(v as RuleLevel)}>
            <SelectTrigger aria-labelledby={`${id}-level`} className="w-full"><SelectValue>{(v: unknown) => v === "project" ? "This project" : "Every project"}</SelectValue></SelectTrigger>
            <SelectContent><SelectItem value="workspace">Every project</SelectItem>{canProject && <SelectItem value="project">This project</SelectItem>}</SelectContent>
          </Select></div>
      </div>
      <Separator />
      <div className="space-y-1"><Label id={`${id}-template`}>Then use template</Label>
        <Select value={rule.then.template ?? ""} onValueChange={(v) => setThen({ template: v ? String(v) : undefined })}>
          <SelectTrigger aria-labelledby={`${id}-template`} className="w-full"><SelectValue>{(v: unknown) => templates.find((t) => t.id === v)?.name ?? "Keep whatever template is on the video"}</SelectValue></SelectTrigger>
          <SelectContent><SelectItem value="">Keep whatever template is on the video</SelectItem>{templates.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}{t.builtin ? "" : " (yours)"}</SelectItem>)}</SelectContent>
        </Select></div>
      <RuleSlots slots={templates.find((t) => t.id === rule.then.template)?.slots ?? []} assets={assets}
        value={rule.then.slots ?? {}} onChange={(slots) => setThen({ slots })} />
      <div className="space-y-1"><Label htmlFor={`${id}-overrides`}>Template overrides (JSON)</Label><Textarea id={`${id}-overrides`} className="font-mono text-xs" value={overrides} placeholder='{"images":{"mode":"off"}}' onChange={(e) => setOverrides(e.target.value)} />{jsonError && <p className="text-xs text-destructive">{jsonError}</p>}</div>
      <div className="space-y-1"><Label htmlFor={`${id}-prompt`}>Instruction for the agent</Label><Textarea id={`${id}-prompt`} value={rule.then.prompt ?? ""} placeholder="Never cover the game with pictures." onChange={(e) => setThen({ prompt: e.target.value })} /></div>
      <Checkbox checked={rule.enabled} onCheckedChange={(enabled) => set({ enabled })}>Enabled</Checkbox>
      <div className="flex gap-2"><Button size="sm" type="submit" disabled={pending}>{pending ? <Loader2 className="motion-safe:animate-spin" /> : null}Save rule</Button><Button size="sm" type="button" variant="ghost" onClick={onCancel}>Cancel</Button></div>
    </form>
  );
}

function GlossaryEditor({ glossary, canProject, pending, onSave }: {
  glossary: Glossary; canProject: boolean; pending: string; onSave: (glossary: Glossary, level: RuleLevel) => void;
}) {
  const [terms, setTerms] = useState(glossary.terms.map((t) => ({ term: t.term, aliases: t.aliases.join(", "), note: t.note })));
  const [level, setLevel] = useState<RuleLevel>("workspace");
  useEffect(() => { setTerms(glossary.terms.map((t) => ({ term: t.term, aliases: t.aliases.join(", "), note: t.note }))); }, [glossary]);
  const update = (i: number, patch: Partial<(typeof terms)[number]>) => setTerms(terms.map((t, n) => (n === i ? { ...t, ...patch } : t)));
  return (
    <form className="space-y-3" onSubmit={(e) => {
      e.preventDefault();
      onSave({ terms: terms.filter((t) => t.term.trim()).map((t) => ({ term: t.term.trim(), aliases: t.aliases.split(",").map((a) => a.trim()).filter(Boolean), note: t.note.trim() })) }, level);
    }}>
      <p className="text-xs text-muted-foreground">Names spelled exactly this way in captions and titles. Aliases are what the recogniser writes instead.</p>
      <div className="space-y-2">
        {terms.map((t, i) => <div key={i} className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
          <Input aria-label="Term" placeholder="Claude" value={t.term} onChange={(e) => update(i, { term: e.target.value })} />
          <Input aria-label="Misheard as" placeholder="clod, cloud AI" value={t.aliases} onChange={(e) => update(i, { aliases: e.target.value })} />
          <Input aria-label="What it is" placeholder="Anthropic's model" value={t.note} onChange={(e) => update(i, { note: e.target.value })} />
          <Button size="icon-sm" type="button" variant="ghost" aria-label={`Remove ${t.term || "row"}`} onClick={() => setTerms(terms.filter((_, n) => n !== i))}><Trash2 /></Button>
        </div>)}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" type="button" variant="outline" onClick={() => setTerms([...terms, { term: "", aliases: "", note: "" }])}><Plus />Add term</Button>
        {canProject && <Select value={level} onValueChange={(v) => setLevel(v as RuleLevel)}>
          <SelectTrigger aria-label="Save glossary for" className="w-44"><SelectValue>{(v: unknown) => v === "project" ? "This project" : "Every project"}</SelectValue></SelectTrigger>
          <SelectContent><SelectItem value="workspace">Every project</SelectItem><SelectItem value="project">This project</SelectItem></SelectContent>
        </Select>}
        <Button size="sm" type="submit" disabled={pending === "glossary"}>{pending === "glossary" ? <Loader2 className="motion-safe:animate-spin" /> : null}Save glossary</Button>
      </div>
      {canProject && <p className="text-xs text-muted-foreground">Shown merged: the project's entries win over the workspace's on the same term. Saving writes the whole list at the chosen level.</p>}
    </form>
  );
}

function PreferencesEditor({ label, text, pending, onSave }: { label: string; text: string; pending: boolean; onSave: (text: string) => void }) {
  const id = useId();
  const [draft, setDraft] = useState(text);
  useEffect(() => setDraft(text), [text]);
  return (
    <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); onSave(draft); }}>
      <Label htmlFor={id}>{label}</Label>
      <Textarea id={id} rows={5} value={draft} placeholder="Short hooks. Never emojis. Captions two words per line. Music always under the voice." onChange={(e) => setDraft(e.target.value)} />
      <Button size="sm" type="submit" disabled={pending || draft === text}>{pending ? <Loader2 className="motion-safe:animate-spin" /> : null}Save</Button>
    </form>
  );
}

/**
 * The observation bank, and the one place where it turns into standing preferences:
 * on request, an agent proposes, and each proposal is accepted or ignored by hand.
 */
function Review({ observations, glossary, preferences, pending, review, onAcceptRule, onAcceptGlossary, onAcceptPreferences }: {
  observations: Observation[]; glossary: Glossary; preferences: string; pending: string;
  review: () => Promise<Proposals>;
  onAcceptRule: (rule: Rule) => void; onAcceptGlossary: (glossary: Glossary) => void; onAcceptPreferences: (text: string) => void;
}) {
  const [proposals, setProposals] = useState<Proposals | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [accepted, setAccepted] = useState<Set<string>>(new Set());
  const accept = (key: string, action: () => void) => { action(); setAccepted(new Set([...accepted, key])); };
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <p className="text-sm font-medium">What you have corrected</p>
          <p className="text-xs text-muted-foreground">{observations.length ? `${observations.length} recent correction${observations.length === 1 ? "" : "s"}, noted without asking.` : "Nothing yet. Corrections to what the agent, a rule or a template placed are noted here."}</p>
        </div>
        <Button size="xs" variant="outline" disabled={busy || !observations.length} onClick={async () => {
          setBusy(true); setError(""); setAccepted(new Set());
          try { setProposals(await review()); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
        }}>{busy ? <Loader2 className="motion-safe:animate-spin" /> : <Wand2 />}Review my preferences</Button>
      </div>
      {!!observations.length && <Disclosure variant="plain" summary="Recent corrections">
        <ul className="space-y-1 text-xs text-muted-foreground">{observations.slice(-15).reverse().map((o) => <li key={o.id}>{o.text}</li>)}</ul></Disclosure>}
      {proposals && <div className="space-y-3 rounded-2xl bg-white/[0.03] p-4 text-sm ring-1 ring-foreground/10">
        {proposals.notes && <p className="text-xs text-muted-foreground">{proposals.notes}</p>}
        {!proposals.rules.length && !proposals.glossary.length && !proposals.preferences && <p className="text-xs text-muted-foreground">Nothing repeats often enough to propose a rule.</p>}
        {proposals.rules.map((rule) => <div key={rule.id} className="flex items-start gap-2">
          <div className="min-w-0 flex-1"><span className="font-medium">{rule.name}</span><span className="block text-xs text-muted-foreground">When {rule.when} → {[rule.then.template && `template ${rule.then.template}`, rule.then.overrides && `overrides ${JSON.stringify(rule.then.overrides)}`, rule.then.prompt].filter(Boolean).join(" · ")}</span></div>
          <Button size="xs" variant="outline" disabled={accepted.has(`rule:${rule.id}`) || pending === `save:${rule.id}`} onClick={() => accept(`rule:${rule.id}`, () => onAcceptRule(rule))}>{accepted.has(`rule:${rule.id}`) ? "Saved" : "Save rule"}</Button>
        </div>)}
        {proposals.glossary.map((term) => <div key={term.term} className="flex items-start gap-2">
          <div className="min-w-0 flex-1"><span className="font-medium">{term.term}</span><span className="block text-xs text-muted-foreground">{term.aliases.length ? `misheard as ${term.aliases.join(", ")}` : ""}{term.note ? ` · ${term.note}` : ""}</span></div>
          <Button size="xs" variant="outline" disabled={accepted.has(`term:${term.term}`)} onClick={() => accept(`term:${term.term}`, () => onAcceptGlossary({ terms: [...glossary.terms.filter((t) => t.term.toLowerCase() !== term.term.toLowerCase()), term] }))}>{accepted.has(`term:${term.term}`) ? "Saved" : "Add to glossary"}</Button>
        </div>)}
        {proposals.preferences && <div className="flex items-start gap-2">
          <p className="min-w-0 flex-1 whitespace-pre-wrap text-xs">{proposals.preferences}</p>
          <Button size="xs" variant="outline" disabled={accepted.has("prefs")} onClick={() => accept("prefs", () => onAcceptPreferences([preferences, proposals.preferences].filter(Boolean).join("\n")))}>{accepted.has("prefs") ? "Added" : "Add to preferences"}</Button>
        </div>}
      </div>}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </section>
  );
}
