"use client";
import { useCallback, useEffect, useId, useState, type ReactNode } from "react";
import { Loader2, Plus, Trash2, Wand2 } from "lucide-react";
import { api } from "@agentcut/core/common/api/client";
import type { Rule, RuleRecord, RuleLevel } from "@agentcut/core/modules/rules/types";
import type { RuleEvaluation } from "@agentcut/core/modules/rules/server/evaluate";
import type { RuleApplyResult } from "@agentcut/core/modules/rules/server/apply";
import type { Glossary } from "@agentcut/core/modules/rules/server/glossary";
import type { Proposals, Observation } from "@agentcut/core/modules/rules/server/observations";

import type { AssetSummary } from "@agentcut/core/common/api/client";
import { RuleForm } from "./rule-form";
import { RuleEffects } from "./rule-effects";
import { DeleteRule } from "./delete-rule";
import { editableRule, ruleEffects } from "@agentcut/core/modules/rules/lib/rule-form";
import { Badge } from "../../../common/ui/badge";
import { Button } from "../../../common/ui/button";
import { Checkbox } from "@/common/ui/checkbox";
import { Disclosure } from "@/common/ui/disclosure";
import { Input } from "../../../common/ui/input";
import { Label } from "../../../common/ui/label";
import { Textarea } from "../../../common/ui/textarea";
import { StyleChoice } from "@/modules/packs/components/style-choice";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../common/ui/select";
import { Separator } from "../../../common/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../../common/ui/tabs";
import { type TemplateOption, type Loaded } from "@agentcut/core/modules/rules/types";
import { EMPTY_RULE, STAGE_LABELS } from "@agentcut/core/modules/rules/data";


export function RulesPanel({ projectId, sequenceId, beforeApply, afterApply }: {
  projectId?: string;
  /** The open video, for judging and applying rules against it. */
  sequenceId?: string;
  beforeApply?: () => Promise<boolean>;
  afterApply?: () => Promise<void>;
}) {
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState("");
  const [notes, setNotes] = useState<string[]>([]);
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
    setPending(label); setError(""); setNotes([]);
    try {
      const result = await call();
      // A save can succeed and still be worth a word: a rule naming a slot its template
      // has not got is saved, and never fills anything.
      const said = (result as { warnings?: string[] } | undefined)?.warnings;
      if (Array.isArray(said) && said.length) setNotes(said);
      await load();
    }
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
        <RuleList rules={data.rules} templates={data.templates} assets={data.assets} projectId={projectId} canProject={!!projectId} pending={pending}
          onSave={async (rule, level) => { const result = await write({ tool: "rules.save", rule, level }, { action: "rules.save", rule }); await load(); return result; }}
          onDelete={async (rule) => { await write({ tool: "rules.delete", id: rule.id, level: rule.level }, { action: "rules.delete", id: rule.id }); await load(); }}>
          {projectId && sequenceId && <JudgeAndApply projectId={projectId} sequenceId={sequenceId} rules={data.rules} beforeApply={beforeApply} afterApply={afterApply} onError={setError} />}
        </RuleList>
      </TabsContent>
      <TabsContent value="glossary" className="pt-4">
        <GlossaryEditor glossary={data.glossary} canProject={!!projectId} pending={pending}
          onSave={(glossary, level) => run("glossary", () => write({ tool: "glossary.save", glossary, level }, { action: "glossary.save", glossary }))} />
      </TabsContent>
      <TabsContent value="preferences" className="space-y-4 pt-4">
        {projectId && <StyleChoice projectId={projectId} sequenceId={sequenceId} />}
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
      {notes.map((note) => <p key={note} role="status" className="pt-3 text-sm text-amber-500">{note}</p>)}
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
  if (!candidates.length) return <p className="text-xs text-muted-foreground">No editing rules yet. Create one for this project or for every project.</p>;

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
        <p className="flex-1 text-sm font-medium">Apply rules to this video</p>
        <Button size="xs" variant="outline" disabled={!!busy} onClick={judge}>{busy === "judge" ? <Loader2 className="motion-safe:animate-spin" /> : <Wand2 />}Check this video</Button>
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
      <Button size="sm" disabled={!checked.size || !!busy} onClick={apply}>{busy === "apply" ? <Loader2 className="motion-safe:animate-spin" /> : null}Apply selected rules</Button>
      {result && <p role="status" className="text-xs text-muted-foreground">{result}</p>}
    </div>
  );
}

function RuleList({ rules, templates, assets, projectId, canProject, pending, onSave, onDelete, children }: {
  children?: ReactNode; rules: RuleRecord[]; templates: TemplateOption[]; assets: AssetSummary[]; projectId?: string; canProject: boolean; pending: string;
  onSave: (rule: Rule, level: RuleLevel) => Promise<unknown>; onDelete: (rule: RuleRecord) => Promise<unknown>;
}) {
  const [editing, setEditing] = useState<{ rule: Rule; level: RuleLevel } | null>(null);
  if (editing) return <RuleForm key={editing.rule.id || "new"} initial={editing.rule} isNew={!editing.rule.id} level={editing.level} templates={templates} assets={assets} projectId={projectId}
    onCancel={() => setEditing(null)} onSave={onSave} />;
  return (
    <div className="space-y-3">
      {children}
      <ul className="space-y-2">
        {rules.map((r) => <li key={`${r.level}:${r.id}`} className="rounded-xl border border-border p-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 flex-1 break-words font-medium">{r.name}</span>
            <Badge variant="outline" className="text-[10px]">{r.level === "workspace" ? "Every project" : "This project"}</Badge>
            <Badge variant="secondary" className="text-[10px]">{STAGE_LABELS[r.stage]}</Badge>
            {!r.enabled && <Badge variant="destructive" className="text-[10px]">off</Badge>}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">When {r.when}</p>
          <RuleEffects rule={r} templates={templates} assets={assets} />
          <div className="mt-2 flex gap-2">
            <Button size="xs" variant="outline" onClick={() => setEditing({ rule: editableRule(r), level: r.level })}>Edit</Button>
            <DeleteRule name={r.name} pending={pending === `delete:${r.id}`} onDelete={() => onDelete(r)} />
          </div>
        </li>)}
      </ul>
      <Button size="sm" onClick={() => setEditing({ rule: EMPTY_RULE, level: canProject ? "project" : "workspace" })}><Plus />Create a rule</Button>

    </div>
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
          <div className="min-w-0 flex-1"><span className="font-medium">{rule.name}</span><span className="block text-xs text-muted-foreground">When {rule.when} → {ruleEffects(rule, []).join("; ")}</span></div>
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
