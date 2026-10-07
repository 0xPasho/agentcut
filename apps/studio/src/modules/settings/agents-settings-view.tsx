"use client";
import { useId, useState } from "react";
import { CircleCheck, CircleSlash, KeyRound, Loader2, RefreshCw, Terminal } from "lucide-react";
import Link from "next/link";
import { cn } from "cn";
import { useAgents } from "@/modules/agent/hooks/agent-store";
import { prettyModelLabel } from "@agentcut/core/modules/agent/lib/model-catalog";
import type { HarnessStatus } from "@agentcut/core/modules/agent/server/detect";
import { HARNESS_MARKS } from "@/common/components/brand-marks";
import { Badge } from "@/common/ui/badge";
import { Button } from "@/common/ui/button";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/common/ui/select";
import { ErrorLine, Loading, Panel, PanelHeading, SectionHeader } from "./components/section-header";
import { encode, decode, label, labelFor } from "@agentcut/core/modules/settings/lib";

/**
 * Which agent runs your work, and what it searches with.
 *
 * Three things, in the order they matter: what this machine actually has, which
 * harness and model is the answer for everything, and where that answer is worth
 * changing per kind of work (decision 50 — the strong model earns its cost on
 * choosing clips and writing plans, not on tagging).
 *
 * The picture-search keys used to sit at the bottom of this page; they are on This
 * machine now (decision 135), because a key is never handed to an agent.
 */
export function AgentsSettings() {
  const { harnesses, selection, workspaceDefault, tasks, loading, error, select, selectTask, refresh } = useAgents();

  return (
    <section className="flex flex-col gap-5">
      <SectionHeader
        title="Agents"
        action={
          <Button size="sm" variant="outline" disabled={loading} onClick={() => void refresh()}>
            {loading ? <Loader2 aria-hidden className="motion-safe:animate-spin" /> : <RefreshCw aria-hidden />}Check again
          </Button>
        }
      >
        Every edit runs a coding agent already signed in on this machine. Nothing is uploaded.
      </SectionHeader>

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">On this machine</h3>
        {loading && !harnesses.length ? (
          <Loading rows={4} label="Looking for agent CLIs" />
        ) : (
          <ul className="flex flex-col gap-2">
            {harnesses.map((harness) => <li key={harness.id}><HarnessRow harness={harness} /></li>)}
          </ul>
        )}
      </div>

      <Panel className="flex flex-col gap-3">
        <PanelHeading title="Default agent">What runs unless a project or a kind of work says otherwise.</PanelHeading>
        <ModelSelect
          label="Default agent and model"
          harnesses={harnesses}
          value={workspaceDefault ? { provider: workspaceDefault.provider, model: workspaceDefault.model } : null}
          inheritLabel="The first agent installed"
          onChange={(provider, model) => void select(provider, model)}
        />
        {!workspaceDefault && selection.provider && (
          <p className="text-xs text-muted-foreground">Right now that is {label(harnesses, selection.provider, selection.model)}.</p>
        )}
      </Panel>

      <Panel className="flex flex-col gap-3">
        <PanelHeading title="A different model for some work">
          Choosing clips out of two hours of footage and writing the plan a set of videos follows are
          worth the strong model. Judging one rule or reading your corrections is not. Anything left on
          the default follows the default.
        </PanelHeading>
        <ul className="flex flex-col gap-4">
          {tasks.map((task) => (
            <li key={task.task} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,20rem)] sm:items-start sm:gap-4">
              <div className="min-w-0">
                <p className="text-sm">{task.label}</p>
                <p className="text-xs text-muted-foreground">{task.what}</p>
              </div>
              <ModelSelect
                label={task.label}
                harnesses={harnesses}
                value={task.own ? { provider: task.own.provider, model: task.own.model } : null}
                inheritLabel="Same as the default"
                onChange={(provider, model) => void selectTask(task.task, provider, model)}
              />
            </li>
          ))}
        </ul>
      </Panel>

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <KeyRound aria-hidden className="size-3.5" />The keys for picture search are under <Link href="/settings/machine" className="underline underline-offset-2">This machine</Link>.
      </p>

      <ErrorLine>{error}</ErrorLine>
    </section>
  );
}

function HarnessRow({ harness }: { harness: HarnessStatus }) {
  const Mark = HARNESS_MARKS[harness.id];
  let state = "Not installed";
  if (harness.installed) state = "Signed out";
  if (harness.ready) state = "Ready";
  return (
    <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 rounded-3xl bg-card px-4 py-3.5 ring-1 ring-foreground/10", !harness.ready && "opacity-70")}>
      <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-xl bg-foreground/5">
        {Mark ? <Mark className="size-4.5" /> : <Terminal className="size-4.5" strokeWidth={2} />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
          {harness.label}
          {harness.accountLabel && <Badge variant="outline" className="font-normal">{harness.accountLabel}</Badge>}
        </p>
        <p className="text-xs text-muted-foreground">
          {harness.ready
            ? `${harness.models.length} model${harness.models.length === 1 ? "" : "s"} · ${harness.modelSource === "cli" ? "asked the CLI" : "built-in list"}`
            : harness.reason}
        </p>
      </div>
      {/* A status never wears the accent: ready is a neutral word with a check beside it. */}
      <span className={cn("flex shrink-0 items-center gap-1.5 text-xs", harness.ready ? "text-foreground" : "text-muted-foreground")}>
        {harness.ready ? <CircleCheck aria-hidden className="size-4" /> : <CircleSlash aria-hidden className="size-4" />}
        {state}
      </span>
    </div>
  );
}

/**
 * Harness and model as one choice, because they are one: picking a model under
 * another harness switches the harness too. Every harness is listed, including the
 * ones that cannot run — a row that is missing reads as "not a thing here", which
 * is a different and wrong story from "installed but signed out".
 */
function ModelSelect({ label: name, harnesses, value, inheritLabel, onChange }: {
  label: string;
  harnesses: HarnessStatus[];
  value: { provider: string; model: string } | null;
  inheritLabel: string;
  onChange: (provider: string, model: string) => void;
}) {
  const id = useId();
  const current = value ? encode(value.provider, value.model) : "";
  return (
    <>
      <span id={id} className="sr-only">{name}</span>
      <Select value={current} onValueChange={(v) => { const [provider, model] = decode(String(v)); onChange(provider, model); }}>
        <SelectTrigger aria-labelledby={id} className="w-full">
          <SelectValue>{(v: unknown) => (v ? labelFor(harnesses, String(v)) : inheritLabel)}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="">{inheritLabel}</SelectItem>
          {harnesses.map((harness) => (
            <SelectGroup key={harness.id}>
              <SelectLabel>{harness.label}{harness.ready ? "" : ` — ${harness.installed ? "signed out" : "not installed"}`}</SelectLabel>
              <SelectItem value={encode(harness.id, "")}>{harness.inheritLabel}</SelectItem>
              {harness.models.map((model) => (
                <SelectItem key={model.id} value={encode(harness.id, model.id)}>{prettyModelLabel(model)}</SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
    </>
  );
}
