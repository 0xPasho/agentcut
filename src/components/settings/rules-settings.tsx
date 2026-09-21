"use client";
import { useId, useState } from "react";
import { ArrowLeft, ChevronDown, ChevronUp, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/client";
import type { Rule, RuleRecord } from "@/lib/rules/schema";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Empty, SectionHeader } from "./section-header";
import { Toggle } from "./toggle";
import { useWorkspaceSettings, type TemplateOption } from "./use-workspace";

/**
 * Rules for every project, with the whole story in one place: what each one judges,
 * what it does about it, whether it is on, and the order they run in. Rules about
 * one project or one video stay in the editor, beside the video they are about.
 *
 * Every button here calls `rules.save` or `rules.delete` — the tools an agent calls,
 * with the same schema doing the same validation. There is no settings-only writer.
 */
const EMPTY_RULE: Rule = { id: "", name: "", description: "", when: "", stage: "both", priority: 100, enabled: true, then: {} };

const STAGE_LABELS: Record<string, string> = { select: "Choosing clips", edit: "Editing", both: "Choosing and editing" };
const STAGE_HELP: Record<string, string> = {
  select: "Shapes which moments become clips, before any editing happens.",
  edit: "Shapes how a video is edited once it exists.",
  both: "Both: it shapes the choice of clips and the editing.",
};

export function RulesSettings() {
  const { data, error, pending, run, setError } = useWorkspaceSettings();
  const [editing, setEditing] = useState<{ rule: Rule; isNew: boolean } | null>(null);

  const rules = (data?.rules ?? []).filter((r) => r.level === "workspace");
  const templates = data?.templates ?? [];
  const terms = data?.glossary.terms ?? [];

  const save = (rule: Rule) =>
    run(`save:${rule.id}`, async () => {
      await api.workspace({ action: "rules.save", rule });
      setEditing(null);
    });

  /**
   * Order is a number on each rule, so moving one is a renumber of the list. Every
   * rule whose number changed is written; a rule that did not move is not touched,
   * which keeps a project-level rule with the same id out of this entirely.
   */
  const move = (index: number, by: -1 | 1) => {
    const next = [...rules];
    const target = index + by;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    const changed = next
      .map((rule, i) => ({ rule, priority: (i + 1) * 10 }))
      .filter(({ rule, priority }) => rule.priority !== priority);
    return run(`move:${rules[index].id}`, async () => {
      for (const { rule, priority } of changed) {
        await api.workspace({ action: "rules.save", rule: strip({ ...rule, priority }) });
      }
    });
  };

  if (editing) {
    return (
      <RuleForm
        initial={editing.rule}
        isNew={editing.isNew}
        templates={templates}
        terms={terms.map((t) => t.term)}
        pending={pending.startsWith("save:")}
        onCancel={() => { setEditing(null); setError(""); }}
        onSave={save}
        error={error}
      />
    );
  }

  return (
    <section className="flex flex-col gap-5">
      <SectionHeader
        title="Rules"
        action={<Button size="sm" onClick={() => setEditing({ rule: EMPTY_RULE, isNew: true })}><Plus />New rule</Button>}
      >
        A rule is a sentence the agent judges against your material, and something it does when the
        sentence holds. These apply to every project; rules for one project or one video live in the
        editor, next to what they are about.
      </SectionHeader>

      {!data ? (
        <p className="text-sm text-muted-foreground">Loading your rules…</p>
      ) : rules.length ? (
        <>
          <ol className="flex flex-col gap-2">
            {rules.map((rule, index) => (
              <li key={rule.id} className="flex flex-col gap-3 rounded-2xl bg-card px-4 py-3.5 ring-1 ring-foreground/10">
                <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{rule.name}</span>
                      <Badge variant="secondary" className="text-[10px]">{STAGE_LABELS[rule.stage]}</Badge>
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">When {rule.when}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{describe(rule, templates)}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      size="icon-sm" variant="ghost" aria-label={`Move ${rule.name} earlier`}
                      disabled={index === 0 || !!pending} onClick={() => move(index, -1)}
                    ><ChevronUp /></Button>
                    <Button
                      size="icon-sm" variant="ghost" aria-label={`Move ${rule.name} later`}
                      disabled={index === rules.length - 1 || !!pending} onClick={() => move(index, 1)}
                    ><ChevronDown /></Button>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <Toggle
                    checked={rule.enabled}
                    about={rule.name}
                    disabled={pending === `save:${rule.id}`}
                    label={rule.enabled ? "On" : "Off"}
                    onChange={(enabled) => save(strip({ ...rule, enabled }))}
                  />
                  <span className="flex-1" />
                  <Button size="xs" variant="outline" onClick={() => setEditing({ rule: strip(rule), isNew: false })}>
                    <Pencil />Edit
                  </Button>
                  <DeleteRule rule={rule} pending={pending === `delete:${rule.id}`}
                    onDelete={() => run(`delete:${rule.id}`, () => api.workspace({ action: "rules.delete", id: rule.id }))} />
                </div>
              </li>
            ))}
          </ol>
          <p className="text-xs text-muted-foreground">
            They run from the top down. The first rule that names a template wins that choice; everything
            else each matched rule asks for is added on top, in this order.
          </p>
        </>
      ) : (
        <Empty title="No rules yet" action={<Button size="sm" className="mt-2" onClick={() => setEditing({ rule: EMPTY_RULE, isNew: true })}><Plus />New rule</Button>}>
          A rule is how you stop repeating yourself: “when the clip is gameplay, never cover the game
          with pictures.” The agent judges the sentence; the app does the rest.
        </Empty>
      )}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </section>
  );
}

/** A record carries where it was read from; a rule you save is only the document. */
const strip = (r: RuleRecord | (Rule & Partial<RuleRecord>)): Rule => {
  const { level, file, promptText, ...rule } = r as RuleRecord;
  void level; void file; void promptText;
  return rule;
};

function describe(rule: Rule, templates: TemplateOption[]): string {
  const parts = [
    rule.then.template && `uses the ${templates.find((t) => t.id === rule.then.template)?.name ?? rule.then.template} template`,
    rule.then.overrides && Object.keys(rule.then.overrides).length ? "changes template settings" : "",
    (rule.then.prompt || rule.then.promptFile) && "tells the agent something",
  ].filter(Boolean);
  return parts.length ? `Then it ${parts.join(", ")}.` : "It does nothing yet — open it and say what should happen.";
}

function DeleteRule({ rule, pending, onDelete }: { rule: RuleRecord; pending: boolean; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="xs" variant="ghost" aria-label={`Delete ${rule.name}`} />}>
        <Trash2 aria-hidden />
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete this rule?</DialogTitle>
          <DialogDescription className="break-words">
            “{rule.name}” stops applying to every project. Videos it already changed keep those changes.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button variant="destructive" disabled={pending} onClick={() => { onDelete(); setOpen(false); }}>
            {pending && <Loader2 aria-hidden className="motion-safe:animate-spin" />}Delete rule
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

function RuleForm({ initial, isNew, templates, terms, pending, error, onSave, onCancel }: {
  initial: Rule; isNew: boolean; templates: TemplateOption[]; terms: string[];
  pending: boolean; error: string; onSave: (rule: Rule) => void; onCancel: () => void;
}) {
  const id = useId();
  const [rule, setRule] = useState<Rule>(initial);
  const [overrides, setOverrides] = useState(initial.then.overrides ? JSON.stringify(initial.then.overrides, null, 2) : "");
  const [jsonError, setJsonError] = useState("");
  const set = (patch: Partial<Rule>) => setRule((current) => ({ ...current, ...patch }));
  const setThen = (patch: Partial<Rule["then"]>) => setRule((current) => ({ ...current, then: { ...current.then, ...patch } }));

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        let parsed: Record<string, unknown> | undefined;
        if (overrides.trim()) {
          try { parsed = JSON.parse(overrides); }
          catch { setJsonError("Write the settings as JSON, for example {\"images\":{\"mode\":\"off\"}}"); return; }
        }
        setJsonError("");
        onSave({
          ...rule,
          id: rule.id || slug(rule.name),
          subject: rule.subject || undefined,
          then: {
            ...rule.then,
            overrides: parsed,
            template: rule.then.template || undefined,
            prompt: rule.then.prompt?.trim() || undefined,
          },
        });
      }}
    >
      <div className="flex items-center gap-2">
        <Button type="button" size="icon-sm" variant="ghost" aria-label="Back to rules" onClick={onCancel}><ArrowLeft /></Button>
        <h2 className="font-heading text-xl tracking-[-0.02em]">{isNew ? "New rule" : rule.name || "Edit rule"}</h2>
      </div>

      <fieldset className="flex flex-col gap-4 rounded-2xl bg-card px-4 py-4 ring-1 ring-foreground/10">
        <legend className="sr-only">What the rule is</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-name`}>Name</Label>
            <Input id={`${id}-name`} required value={rule.name} placeholder="Gameplay stays clean"
              onChange={(e) => set({ name: e.target.value, ...(isNew ? { id: slug(e.target.value) } : {}) })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-id`}>Id</Label>
            <Input id={`${id}-id`} required pattern="[a-z0-9][a-z0-9\-]*" value={rule.id} disabled={!isNew}
              aria-describedby={`${id}-id-help`} onChange={(e) => set({ id: e.target.value })} />
            <p id={`${id}-id-help`} className="text-xs text-muted-foreground">
              {isNew ? "Lowercase letters, digits and dashes. It is how packs and edits refer to this rule." : "Fixed once a rule exists, because edits it made point at it."}
            </p>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-when`}>When</Label>
          <Textarea id={`${id}-when`} required rows={2} value={rule.when} placeholder="the clip is gameplay footage"
            aria-describedby={`${id}-when-help`} onChange={(e) => set({ when: e.target.value })} />
          <p id={`${id}-when-help`} className="text-xs text-muted-foreground">
            A sentence an agent reads against the video. Be literal: a rule about gameplay should match
            gameplay, not a video that mentions a game.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-description`}>Note to yourself <span className="font-normal text-muted-foreground">(optional)</span></Label>
          <Input id={`${id}-description`} value={rule.description} placeholder="Why this exists, for when you find it in a year."
            onChange={(e) => set({ description: e.target.value })} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <span id={`${id}-stage`} className="text-sm font-medium">Applies while</span>
            <Select value={rule.stage} onValueChange={(v) => set({ stage: v as Rule["stage"] })}>
              <SelectTrigger aria-labelledby={`${id}-stage`} aria-describedby={`${id}-stage-help`} className="w-full">
                <SelectValue>{(v: unknown) => STAGE_LABELS[String(v)]}</SelectValue>
              </SelectTrigger>
              <SelectContent>{Object.entries(STAGE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
            </Select>
            <p id={`${id}-stage-help`} className="text-xs text-muted-foreground">{STAGE_HELP[rule.stage]}</p>
          </div>
          <div className="space-y-1.5">
            <span id={`${id}-subject`} className="text-sm font-medium">About a subject <span className="font-normal text-muted-foreground">(optional)</span></span>
            <Select value={rule.subject ?? ""} onValueChange={(v) => set({ subject: String(v) })}>
              <SelectTrigger aria-labelledby={`${id}-subject`} aria-describedby={`${id}-subject-help`} className="w-full">
                <SelectValue>{(v: unknown) => (v ? String(v) : "Any subject")}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Any subject</SelectItem>
                {terms.map((term) => <SelectItem key={term} value={term}>{term}</SelectItem>)}
              </SelectContent>
            </Select>
            <p id={`${id}-subject-help`} className="text-xs text-muted-foreground">Names a glossary term this rule is about.</p>
          </div>
        </div>
        <div className="space-y-1">
          <Toggle checked={rule.enabled} about={rule.name || "this rule"} label={rule.enabled ? "On" : "Off"} describedBy={`${id}-enabled-help`} onChange={(enabled) => set({ enabled })} />
          <p id={`${id}-enabled-help`} className="text-xs text-muted-foreground">Off keeps the rule and stops it applying.</p>
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-4 rounded-2xl bg-card px-4 py-4 ring-1 ring-foreground/10">
        <legend className="sr-only">What it does</legend>
        <p className="text-sm font-medium">Then</p>
        <div className="space-y-1.5">
          <span id={`${id}-template`} className="text-sm font-medium">Use this template</span>
          <Select value={rule.then.template ?? ""} onValueChange={(v) => setThen({ template: v ? String(v) : undefined })}>
            <SelectTrigger aria-labelledby={`${id}-template`} className="w-full">
              <SelectValue>{(v: unknown) => templates.find((t) => t.id === v)?.name ?? "Keep whatever template is on the video"}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">Keep whatever template is on the video</SelectItem>
              {templates.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}{t.builtin ? "" : " (yours)"}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-overrides`}>Change these template settings</Label>
          <Textarea id={`${id}-overrides`} rows={3} className="font-mono text-xs" value={overrides}
            placeholder={'{"images":{"mode":"off"}}'} aria-describedby={`${id}-overrides-help`}
            aria-invalid={jsonError ? true : undefined} onChange={(e) => setOverrides(e.target.value)} />
          {jsonError
            ? <p id={`${id}-overrides-help`} role="alert" className="text-xs text-destructive">{jsonError}</p>
            : <p id={`${id}-overrides-help`} className="text-xs text-muted-foreground">A patch over whichever template ends up applied, in the same shape the template panel writes.</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-prompt`}>Tell the agent</Label>
          <Textarea id={`${id}-prompt`} rows={2} value={rule.then.prompt ?? ""} placeholder="Never cover the game with pictures."
            aria-describedby={`${id}-prompt-help`} onChange={(e) => setThen({ prompt: e.target.value })} />
          <p id={`${id}-prompt-help`} className="text-xs text-muted-foreground">Handed to the agent as a standing instruction whenever this rule holds.</p>
        </div>
      </fieldset>

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>{pending && <Loader2 aria-hidden className="motion-safe:animate-spin" />}Save rule</Button>
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}
