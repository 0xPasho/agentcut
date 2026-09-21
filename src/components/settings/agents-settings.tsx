"use client";
import { useId, useState } from "react";
import { CircleCheck, CircleSlash, KeyRound, Loader2, RefreshCw, Terminal } from "lucide-react";
import { cn } from "cn";
import { api } from "@/lib/client";
import { useAgents } from "@/lib/agent-store";
import { prettyModelLabel } from "@/lib/agent/models/catalog";
import type { HarnessStatus } from "@/lib/agent/detect";
import type { ProviderKeyInfo } from "@/lib/secrets";
import { HARNESS_MARKS } from "@/components/brand-marks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SectionHeader } from "./section-header";
import { useWorkspaceSettings } from "./use-workspace";

/**
 * Which agent runs your work, and what it searches with.
 *
 * Three things, in the order they matter: what this machine actually has, which
 * harness and model is the answer for everything, and where that answer is worth
 * changing per kind of work (decision 50 — the strong model earns its cost on
 * choosing clips and writing plans, not on tagging).
 *
 * The keys at the bottom are write-only. Nothing on this page has ever read one
 * back from the server, and neither can an agent: `providerkeys.list` answers
 * whether a key is set and where it came from, never what it is.
 */
export function AgentsSettings() {
  const { harnesses, selection, workspaceDefault, tasks, loading, error, select, selectTask, refresh } = useAgents();
  const workspace = useWorkspaceSettings();

  return (
    <section className="flex flex-col gap-5">
      <SectionHeader
        title="Agents and models"
        action={
          <Button size="sm" variant="outline" disabled={loading} onClick={() => void refresh()}>
            {loading ? <Loader2 aria-hidden className="motion-safe:animate-spin" /> : <RefreshCw aria-hidden />}Check again
          </Button>
        }
      >
        Every edit an agent makes here runs a coding CLI already on this machine. Nothing is uploaded and
        no account is created — the agent signs in where it always did.
      </SectionHeader>

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">On this machine</h3>
        {loading && !harnesses.length ? (
          <p className="text-sm text-muted-foreground">Looking for agent CLIs…</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {harnesses.map((harness) => <li key={harness.id}><HarnessRow harness={harness} /></li>)}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-3 rounded-2xl bg-card px-4 py-4 ring-1 ring-foreground/10">
        <div>
          <h3 className="text-sm font-medium">Default agent</h3>
          <p className="mt-0.5 text-sm text-muted-foreground">
            What runs unless a project or a kind of work says otherwise.
          </p>
        </div>
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
      </div>

      <div className="flex flex-col gap-3 rounded-2xl bg-card px-4 py-4 ring-1 ring-foreground/10">
        <div>
          <h3 className="text-sm font-medium">A different model for some work</h3>
          <p className="mt-0.5 max-w-prose text-sm text-muted-foreground">
            Choosing clips out of two hours of footage and writing the plan a set of videos follows are
            worth the strong model. Judging one rule or reading your corrections is not. Anything left on
            the default follows the default.
          </p>
        </div>
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
      </div>

      <div className="flex flex-col gap-4 rounded-2xl bg-card px-4 py-4 ring-1 ring-foreground/10">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-medium"><KeyRound aria-hidden className="size-4 text-muted-foreground" />Keys for picture search</h3>
          <p className="mt-0.5 max-w-prose text-sm text-muted-foreground">
            Optional. Wikimedia Commons, Openverse and the brand marks need no key and are always on;
            these add stock photography. A key is kept on this machine, never shown again and never
            handed to an agent.
          </p>
        </div>
        <ul className="flex flex-col gap-4">
          {(workspace.data?.providerKeys ?? []).map((key) => (
            <li key={key.id}>
              <ProviderKeyField
                info={key}
                pending={workspace.pending === `key:${key.id}`}
                onSave={(value) => workspace.run(`key:${key.id}`, () => api.workspace({ action: "providerkeys.set", id: key.id, value }))}
              />
            </li>
          ))}
        </ul>
        {workspace.error && <p role="alert" className="text-sm text-destructive">{workspace.error}</p>}
      </div>

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </section>
  );
}

function HarnessRow({ harness }: { harness: HarnessStatus }) {
  const Mark = HARNESS_MARKS[harness.id];
  return (
    <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl bg-card px-4 py-3.5 ring-1 ring-foreground/10", !harness.ready && "opacity-70")}>
      <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-xl bg-foreground/5">
        {Mark ? <Mark className="size-4.5" /> : <Terminal className="size-4.5" strokeWidth={2} />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
          {harness.label}
          {harness.accountLabel && <Badge variant="outline" className="text-[10px] font-normal">{harness.accountLabel}</Badge>}
        </p>
        <p className="text-xs text-muted-foreground">
          {harness.ready
            ? `${harness.models.length} model${harness.models.length === 1 ? "" : "s"} · ${harness.modelSource === "cli" ? "asked the CLI" : "built-in list"}`
            : harness.reason}
        </p>
      </div>
      <span className={cn("flex shrink-0 items-center gap-1.5 text-xs", harness.ready ? "text-primary" : "text-muted-foreground")}>
        {harness.ready ? <CircleCheck aria-hidden className="size-4" /> : <CircleSlash aria-hidden className="size-4" />}
        {harness.ready ? "Ready" : harness.installed ? "Signed out" : "Not installed"}
      </span>
    </div>
  );
}

const encode = (provider: string, model: string) => (provider ? `${provider}:${model}` : "");
const decode = (value: string): [string, string] => {
  if (!value) return ["", ""];
  const cut = value.indexOf(":");
  return [value.slice(0, cut), value.slice(cut + 1)];
};

function label(harnesses: HarnessStatus[], provider: string, model: string): string {
  const harness = harnesses.find((h) => h.id === provider);
  if (!harness) return provider || "nothing yet";
  const row = model ? harness.models.find((m) => m.id === model) : undefined;
  return `${harness.label} · ${model ? (row ? prettyModelLabel(row) : model) : "its default model"}`;
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

const labelFor = (harnesses: HarnessStatus[], encoded: string) => {
  const [provider, model] = decode(encoded);
  return label(harnesses, provider, model);
};

/**
 * A key you can set and clear but never read. There is no reveal and no masked
 * tail: a secret that cannot be shown cannot be shoulder-surfed, screen-shared or
 * pasted into a bug report, and the only thing anybody needs from this field is
 * whether it is set.
 */
function ProviderKeyField({ info, pending, onSave }: { info: ProviderKeyInfo; pending: boolean; onSave: (value: string) => void }) {
  const id = useId();
  const [draft, setDraft] = useState(info.secret ? "" : (info.value ?? ""));
  const fromEnvironment = info.source === "environment";

  return (
    <form
      className="flex flex-col gap-1.5"
      onSubmit={(e) => { e.preventDefault(); onSave(draft); if (info.secret) setDraft(""); }}
    >
      <Label htmlFor={id}>{info.label}</Label>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          id={id}
          type={info.secret ? "password" : "text"}
          autoComplete="off"
          spellCheck={false}
          className="min-w-0 flex-1 font-mono"
          placeholder={info.secret ? (info.set ? "Set — type a new one to replace it" : "Paste the key") : "Paste the id"}
          value={draft}
          aria-describedby={`${id}-help`}
          onChange={(e) => setDraft(e.target.value)}
        />
        <Button type="submit" size="sm" variant="outline" disabled={pending || (!draft.trim() && !info.set)}>
          {pending && <Loader2 aria-hidden className="motion-safe:animate-spin" />}Save
        </Button>
        {info.source === "workspace" && (
          <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => { setDraft(""); onSave(""); }}>Clear</Button>
        )}
      </div>
      <p id={`${id}-help`} className="text-xs text-muted-foreground">
        {info.what}{" "}
        {fromEnvironment
          ? `Answering right now from ${info.env} in this machine's environment; saving one here takes over.`
          : info.set
            ? "Saved on this machine."
            : <>Get one at <span className="break-all">{info.from}</span></>}
      </p>
    </form>
  );
}
