"use client";
import { useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronUp, Package, Pencil, Plus } from "lucide-react";
import { api } from "@agentcut/core/common/api/client";
import type { Rule, SlotAsset } from "@agentcut/core/modules/rules/types";
import { Badge } from "@/common/ui/badge";
import { Button } from "@/common/ui/button";
import { Switch } from "@/common/ui/switch";
import { Empty, ErrorLine, Loading, Panel, SectionHeader } from "./components/section-header";
import { useWorkspaceSettings } from "./hooks";
import { type RuleOption, type TemplateOption } from "@agentcut/core/modules/settings/types";
import { RuleForm } from "@/modules/rules/components/rule-form";
import { RuleEffects } from "@/modules/rules/components/rule-effects";
import { DeleteRule } from "@/modules/rules/components/delete-rule";
import { editableRule } from "@agentcut/core/modules/rules/lib/rule-form";
import { EMPTY_RULE, STAGE_LABELS } from "@agentcut/core/modules/settings/data";
import { strip } from "@agentcut/core/modules/settings/lib";

export function RulesSettings() {
  const { data, error, pending, run, setError, reload } = useWorkspaceSettings();
  const [editing, setEditing] = useState<{ rule: Rule; isNew: boolean } | null>(null);

  const rules = (data?.rules ?? []).filter((r) => r.level === "workspace");
  const templates = data?.templates ?? [];
  const terms = data?.glossary.terms ?? [];
  const packs = data?.packs ?? [];

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
        assets={data?.assets ?? []}
        terms={terms.map((t) => t.term)}
        onCancel={() => { setEditing(null); setError(""); }}
        onSave={async (rule) => { const result = await api.workspace({ action: "rules.save", rule }); await reload(); return result; }}
      />
    );
  }

  const newRule = <Button size="sm" onClick={() => setEditing({ rule: EMPTY_RULE, isNew: true })}><Plus />Create a rule</Button>;

  return (
    <section className="flex flex-col gap-5">
      <SectionHeader title="Rules" action={rules.length ? newRule : undefined}>
        Tell the agent what to repeat in your videos. Each rule has a condition and an action.
        These rules apply across projects; saving one does not change existing videos.
      </SectionHeader>

      {!data && <Loading label="Loading your rules" />}
      {data && !rules.length && (
        <Empty title="No rules yet" action={newRule}>
          A rule is how you stop repeating yourself: “when the clip is gameplay, never cover the game
          with pictures.” The agent judges the sentence; the app does the rest.
        </Empty>
      )}
      {data && rules.length > 0 && (
        <>
          <ol className="flex flex-col gap-2">
            {rules.map((rule, index) => (
              <RuleRow
                key={rule.id} rule={rule} index={index} last={index === rules.length - 1} templates={templates} assets={data.assets} pending={pending}
                packName={rule.pack ? (packs.find((p) => p.id === rule.pack)?.name ?? rule.pack) : null}
                onMove={(by) => move(index, by)}
                onToggle={(enabled) => save(strip({ ...rule, enabled }))}
                onEdit={() => setEditing({ rule: editableRule(rule), isNew: false })}
                onDelete={async () => { await api.workspace({ action: "rules.delete", id: rule.id }); await reload(); }}
              />
            ))}
          </ol>
          <p className="max-w-prose text-xs text-muted-foreground">
            Matching rules run in this order. The first template choice wins. For other settings,
            later rules can replace earlier values. Reorder rules with the arrow buttons.
          </p>
        </>
      )}
      <ErrorLine>{error}</ErrorLine>
    </section>
  );
}

function RuleRow({ rule, index, last, templates, assets, pending, packName, onMove, onToggle, onEdit, onDelete }: {
  rule: RuleOption; index: number; last: boolean; templates: TemplateOption[]; assets: SlotAsset[]; pending: string; packName: string | null;
  onMove: (by: -1 | 1) => void; onToggle: (enabled: boolean) => void; onEdit: () => void; onDelete: () => Promise<unknown>;
}) {
  return (
    <Panel as="li" className="flex flex-col gap-3 py-3.5">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <span aria-hidden className="mt-0.5 w-5 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">{index + 1}</span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{rule.name}</span>
            <Badge variant="secondary">{STAGE_LABELS[rule.stage]}</Badge>
            {rule.subject && <Badge variant="outline" className="font-normal">About {rule.subject}</Badge>}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">When {rule.when}</p>
          <RuleEffects rule={rule} templates={templates} assets={assets} />
          {packName && (
            <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
              <Package aria-hidden className="size-3" />From the <Link href={`/settings/packs/${encodeURIComponent(rule.pack!)}`} className="underline underline-offset-2">{packName}</Link> pack
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button size="icon-sm" variant="ghost" aria-label={`Move ${rule.name} earlier`} disabled={index === 0 || !!pending} onClick={() => onMove(-1)}><ChevronUp /></Button>
          <Button size="icon-sm" variant="ghost" aria-label={`Move ${rule.name} later`} disabled={last || !!pending} onClick={() => onMove(1)}><ChevronDown /></Button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 ps-8">
        <Switch checked={rule.enabled} about={rule.name} disabled={pending === `save:${rule.id}`} label={rule.enabled ? "On" : "Off"} onCheckedChange={onToggle} />
        <span className="flex-1" />
        <Button size="xs" variant="outline" onClick={onEdit}><Pencil />Edit</Button>
        <DeleteRule name={rule.name} pending={pending === `delete:${rule.id}`} onDelete={onDelete} />
      </div>
    </Panel>
  );
}
