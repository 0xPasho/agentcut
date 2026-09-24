"use client";
import { useEffect, useId, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ChevronRight, Download, FolderOpen, Globe, Loader2, Package, Upload } from "lucide-react";
import { api } from "@/common/api/client";
import type { InstalledPack } from "@/modules/packs/types";
import type { PackPreview } from "@/modules/packs/server/packs";
import { Badge } from "@/common/ui/badge";
import { Button } from "@/common/ui/button";
import { Checkbox } from "@/common/ui/checkbox";
import { Input } from "@/common/ui/input";
import { Label } from "@/common/ui/label";
import { Textarea } from "@/common/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/common/ui/select";
import { Empty, ErrorLine, Loading, Panel, PanelHeading, SectionHeader } from "./components/section-header";
import { useWorkspaceSettings } from "./hooks";
import { type ExportDraft, type WorkspaceSettings } from "./types";
import { count, packContents, packOrigin, toExportRequest } from "./lib";
import { EMPTY_EXPORT } from "./data";

/**
 * Packs: what travels between people (decision 133). The list says what is
 * installed and where each came from; a pack's own page says what it brought and
 * holds its guide. Import and export are flows on this page, not dialogs, because
 * what a pack carries is text an agent will follow and is read, not glanced at.
 */
export function PacksSettings() {
  const { data, error, pending, run, setError } = useWorkspaceSettings();
  const [mode, setMode] = useState<"list" | "import" | "export">("list");
  const [notice, setNotice] = useState("");

  const back = () => { setMode("list"); setError(""); };

  if (mode === "import") return <ImportFlow onBack={back} onInstalled={(name) => { setNotice(`Installed ${name}.`); back(); }} run={run} pending={pending} error={error} />;
  if (mode === "export" && data) return <ExportFlow data={data} onBack={back} run={run} pending={pending} error={error} onDone={(dir) => { setNotice(`Written to ${dir}. Serve that folder from any static host, or send it as is.`); back(); }} />;

  const actions = (
    <>
      <Button size="sm" variant="outline" onClick={() => { setNotice(""); setMode("export"); }}><Upload />Export a pack</Button>
      <Button size="sm" onClick={() => { setNotice(""); setMode("import"); }}><Download />Import a pack</Button>
    </>
  );

  return (
    <section className="flex flex-col gap-5">
      <SectionHeader title="Packs" action={actions}>
        Templates, rules, names, assets, a style guide and the standard its videos are held to,
        travelling together. Import one from a folder or a URL — you read everything it carries
        before anything is installed — or export yours to send.
      </SectionHeader>

      {/* Always in the tree, so a screen reader is listening when the text arrives. */}
      <p role="status" className={notice ? "rounded-2xl bg-primary/10 px-4 py-3 text-sm ring-1 ring-primary/30" : "sr-only"}>{notice}</p>

      {!data && <Loading label="Loading your packs" />}
      {data && data.packs.length > 0 && (
        <ul className="flex flex-col gap-2">
          {data.packs.map((pack) => <PackRow key={pack.id} pack={pack} />)}
        </ul>
      )}
      {data && data.packs.length === 0 && (
        <Empty title="No packs installed" action={actions}>
          A pack is how a channel&apos;s way of editing moves to another machine, or how somebody else&apos;s
          reaches yours. Import one to try it; export yours once your rules and templates are worth sharing.
        </Empty>
      )}
      <ErrorLine>{error}</ErrorLine>
    </section>
  );
}

function PackRow({ pack }: { pack: InstalledPack }) {
  const origin = packOrigin(pack.source);
  const Origin = origin.kind === "url" ? Globe : FolderOpen;
  return (
    <li>
      <Link
        href={`/settings/packs/${encodeURIComponent(pack.id)}`}
        className="group flex items-center gap-3 rounded-2xl bg-card px-4 py-3.5 ring-1 ring-foreground/10 transition-[box-shadow,background-color] motion-reduce:transition-none hover:bg-foreground/[0.04] hover:ring-foreground/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-xl bg-foreground/5 text-muted-foreground group-hover:text-primary">
          <Package className="size-5" strokeWidth={1.75} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-sm font-medium">{pack.name}</span>
            <span className="text-xs text-muted-foreground">v{pack.version}{pack.author ? ` · ${pack.author}` : ""}</span>
          </span>
          <span className="mt-0.5 block text-xs text-muted-foreground">{packContents(pack)}</span>
          <span className="mt-1 flex items-center gap-1 truncate text-xs text-muted-foreground/80" title={pack.source}>
            <Origin aria-hidden className="size-3 shrink-0" />{origin.short}
          </span>
        </span>
        <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" />
      </Link>
    </li>
  );
}

// ── Import ───────────────────────────────────────────────────────────────────

/**
 * Import shows everything a pack carries before anything is installed — the rules'
 * text and the style guide most of all, because an agent will read them (decision
 * 9). What would be told to an agent is marked as untrusted until you have read it.
 */
function ImportFlow({ onBack, onInstalled, run, pending, error }: {
  onBack: () => void; onInstalled: (name: string) => void;
  run: (label: string, call: () => Promise<unknown>) => Promise<void>; pending: string; error: string;
}) {
  const id = useId();
  const [source, setSource] = useState("");
  const [preview, setPreview] = useState<PackPreview | null>(null);
  const [readError, setReadError] = useState("");
  const [reading, setReading] = useState(false);

  const read = async () => {
    setReading(true); setReadError(""); setPreview(null);
    try { setPreview(await api.workspace<PackPreview>({ action: "packs.inspect", source })); }
    catch (e) { setReadError((e as Error).message); }
    finally { setReading(false); }
  };

  const install = (replace: boolean) => run("import", async () => {
    const installed = await api.workspace<InstalledPack>({ action: "packs.import", source, replace });
    onInstalled(installed.name);
  });

  const blocked = !!preview && (preview.style.problems.length > 0 || preview.review.problems.length > 0);
  const conflicts = !!preview && (preview.templates.some((t) => t.exists) || preview.rules.some((r) => r.exists));

  return (
    <section className="flex flex-col gap-5">
      <SectionHeader title="Import a pack" eyebrow={<Button type="button" size="xs" variant="ghost" className="-ms-2" onClick={onBack}><ArrowLeft />Packs</Button>}>
        A folder on this machine, or the URL of a pack somebody serves. Nothing is installed until you
        have seen what it carries.
      </SectionHeader>

      <Panel as="form" className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); void read(); }}>
        <Label htmlFor={`${id}-source`}>Folder or URL</Label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input id={`${id}-source`} value={source} autoFocus className="min-w-0 flex-1 font-mono text-xs" placeholder="https://example.com/packs/streamer-kit/pack.json or ~/Downloads/streamer-kit" onChange={(e) => { setSource(e.target.value); setPreview(null); }} />
          <Button type="submit" variant="outline" disabled={!source.trim() || reading}>{reading ? <Loader2 aria-hidden className="motion-safe:animate-spin" /> : null}Read it</Button>
        </div>
        <ErrorLine>{readError}</ErrorLine>
      </Panel>

      {preview && (
        <>
          <Panel className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <p className="flex-1 text-base font-medium">{preview.manifest.name} <span className="text-xs font-normal text-muted-foreground">v{preview.manifest.version}{preview.manifest.author ? ` · ${preview.manifest.author}` : ""}</span></p>
              <Badge variant="destructive" className="text-[10px]">Untrusted until you read it</Badge>
            </div>
            {preview.manifest.description && <p className="text-sm text-muted-foreground">{preview.manifest.description}</p>}
            <p className="text-xs text-muted-foreground">
              {[preview.templates.length && count(preview.templates.length, "template"), preview.rules.length && count(preview.rules.length, "rule"), preview.manifest.glossary.length && count(preview.manifest.glossary.length, "name"), preview.assets.length && count(preview.assets.length, "asset"), preview.examples.length && count(preview.examples.length, "reference"), preview.quickActions.length && count(preview.quickActions.length, "quick action")].filter(Boolean).join(" · ") || "Nothing of its own"}
            </p>
          </Panel>

          {!!preview.templates.length && (
            <Panel className="flex flex-col gap-2">
              <PanelHeading title="Templates" />
              <ul className="space-y-1 text-sm">
                {preview.templates.map((t) => (
                  <li key={t.id} className="text-muted-foreground">
                    <span className="text-foreground">{t.name}</span>{t.extends ? ` — builds on ${t.extends}` : ""}
                    {t.exists ? <span className="block text-xs">You already have a template with this id; it is kept unless you replace yours.</span> : null}
                    {t.missingParent ? <span className="block text-xs text-destructive">It builds on “{t.missingParent}”, which is not on this machine, so it will not appear until that is.</span> : null}
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          {!!preview.rules.length && (
            <Panel className="flex flex-col gap-2">
              <PanelHeading title="Rules">Text an agent will follow. Read it.</PanelHeading>
              <ul className="space-y-2 text-sm">
                {preview.rules.map((r) => (
                  <li key={r.id} className="rounded-xl border border-destructive/30 bg-destructive/5 p-3">
                    <p><span className="font-medium">{r.name}</span> <span className="text-xs text-muted-foreground">· when {r.when}</span></p>
                    {r.prompt ? <pre className="mt-1 whitespace-pre-wrap font-sans text-xs text-muted-foreground">{r.prompt}</pre> : null}
                    {r.exists ? <p className="mt-1 text-xs text-muted-foreground">You already have a rule with this id.</p> : null}
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          {!!preview.style.text && (
            <Panel className="flex flex-col gap-2">
              <PanelHeading title="Style guide">The agents read this before choosing and editing.</PanelHeading>
              <pre tabIndex={0} role="region" aria-label="The pack's style guide" className="max-h-64 overflow-auto whitespace-pre-wrap rounded-xl border border-destructive/30 bg-destructive/5 p-3 font-sans text-xs">{preview.style.text}</pre>
              {!!preview.examples.length && <p className="text-xs text-muted-foreground">{count(preview.examples.length, "reference video")}: {preview.examples.map((e) => e.title || e.file).join(", ")}</p>}
              {!!preview.style.problems.length && <p role="alert" className="text-xs text-destructive">This pack will not install: {preview.style.problems.map((p) => (p.line ? `line ${p.line} ${p.why}` : `its guide ${p.why}`)).join("; ")}.</p>}
            </Panel>
          )}

          {(!!preview.review.review.checks.length || !!preview.review.review.rubric.length) && (
            <Panel className="flex flex-col gap-2">
              <PanelHeading title="What it holds its videos to" />
              <ul className="space-y-1 text-xs text-muted-foreground">
                {preview.review.review.checks.map((c) => <li key={c.id}><span className="font-mono text-foreground">{c.metric}</span> {c.is !== undefined ? `is ${c.is}` : [c.min !== undefined ? `at least ${c.min}` : "", c.max !== undefined ? `at most ${c.max}` : ""].filter(Boolean).join(", ")} — {c.severity}</li>)}
                {preview.review.review.rubric.map((r) => <li key={r.id} className="rounded-xl border border-destructive/30 bg-destructive/5 p-2 text-foreground">{r.ask}{r.fix ? <span className="text-muted-foreground"> — {r.fix}</span> : ""}</li>)}
              </ul>
              {!!preview.review.warnings.length && <ul className="space-y-1 rounded-xl border border-amber-500/40 bg-amber-500/10 p-2">{preview.review.warnings.map((w) => <li key={w} className="text-xs text-amber-300">{w}</li>)}</ul>}
              {!!preview.review.problems.length && <p role="alert" className="text-xs text-destructive">This pack will not install: what it asks of the agent {preview.review.problems.map((p) => (p.line ? `on line ${p.line} ${p.why}` : p.why)).join("; ")}.</p>}
            </Panel>
          )}

          {!!preview.quickActions.length && (
            <Panel className="flex flex-col gap-2">
              <PanelHeading title="Quick actions">Messages sent to the agent with one click.</PanelHeading>
              <ul className="space-y-1 text-xs">{preview.quickActions.map((a) => <li key={a.label} className="rounded-xl border border-destructive/30 bg-destructive/5 p-2"><span className="font-medium">{a.label}</span>: {a.text}</li>)}</ul>
            </Panel>
          )}

          {(!!preview.assets.length || !!preview.manifest.glossary.length) && (
            <Panel className="flex flex-col gap-1 text-xs text-muted-foreground">
              {!!preview.assets.length && <p><span className="font-medium text-foreground">Assets:</span> {preview.assets.map((a) => `${a.name} (${a.kind})`).join(", ")}</p>}
              {!!preview.manifest.glossary.length && <p><span className="font-medium text-foreground">Names:</span> {preview.manifest.glossary.map((g) => g.term).join(", ")}</p>}
            </Panel>
          )}

          <ErrorLine>{error}</ErrorLine>
          <div className="flex flex-wrap gap-2">
            <Button disabled={blocked || pending === "import"} onClick={() => install(false)}>{pending === "import" ? <Loader2 aria-hidden className="motion-safe:animate-spin" /> : <Download aria-hidden />}Install</Button>
            {conflicts && <Button variant="outline" disabled={blocked || pending === "import"} onClick={() => install(true)}>Install and replace mine</Button>}
            <Button variant="ghost" onClick={onBack}>Cancel</Button>
          </div>
        </>
      )}
    </section>
  );
}

// ── Export ───────────────────────────────────────────────────────────────────

/**
 * Export writes a folder any static host can serve. Every field `packs.export`
 * takes is here (decision 133): the form used to send five of them, and a pack
 * exported from the page arrived without its assets, its guide or its criteria.
 */
function ExportFlow({ data, onBack, onDone, run, pending, error }: {
  data: WorkspaceSettings; onBack: () => void; onDone: (dir: string) => void;
  run: (label: string, call: () => Promise<unknown>) => Promise<void>; pending: string; error: string;
}) {
  const id = useId();
  const [draft, setDraft] = useState<ExportDraft>(EMPTY_EXPORT);
  const set = (patch: Partial<ExportDraft>) => setDraft((current) => ({ ...current, ...patch }));
  const toggle = (key: "templates" | "rules" | "assets" | "quickActions", value: string, on: boolean) => {
    const next = new Set(draft[key]);
    if (on) next.add(value); else next.delete(value);
    set({ [key]: next } as Partial<ExportDraft>);
  };
  // A slug from the name, until the id is typed by hand.
  const [idTouched, setIdTouched] = useState(false);
  useEffect(() => { if (!idTouched) set({ id: draft.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") }); }, [draft.name, idTouched]);

  const yours = data.templates.filter((t) => !t.builtin);
  const rules = data.rules.filter((r) => r.level === "workspace");
  const quickActions = data.packs.flatMap((p) => p.quickActions.map((a) => ({ key: `${p.id}:${a.label}`, pack: p.name, ...a })));
  const styled = data.packs;
  const styleLabel = (v: string) => (v ? (styled.find((p) => p.id === v)?.name ?? v) : "None");
  const named = (kind: "image" | "audio" | "video") => data.assets.filter((a) => a.kind === kind);

  const submit = () => run("export", async () => {
    const result = await api.workspace<{ dir: string }>({ action: "packs.export", pack: toExportRequest(draft, data.packs) });
    onDone(result.dir);
  });

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => { e.preventDefault(); submit(); }}
      // Writing a folder replaces whatever is there; only the button does it, never Enter in a field.
      onKeyDown={(e) => { if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") e.preventDefault(); }}
    >
      <SectionHeader title="Export a pack" eyebrow={<Button type="button" size="xs" variant="ghost" className="-ms-2" onClick={onBack}><ArrowLeft />Packs</Button>}>
        Choose what travels. The folder is written under the workspace&apos;s exports; serve it from any
        static host or send it as it is.
      </SectionHeader>

      <Panel as="fieldset" className="grid gap-4 sm:grid-cols-2">
        <legend className="sr-only">What the pack is called</legend>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-name`}>Name</Label>
          <Input id={`${id}-name`} required value={draft.name} placeholder="Streamer kit" onChange={(e) => set({ name: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-id`}>Id</Label>
          <Input id={`${id}-id`} required pattern="[a-z0-9][a-z0-9\-]*" value={draft.id} placeholder="streamer-kit" aria-describedby={`${id}-id-help`} onChange={(e) => { setIdTouched(true); set({ id: e.target.value }); }} />
          <p id={`${id}-id-help`} className="text-xs text-muted-foreground">Lowercase letters, digits and dashes. The folder is named after it.</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-version`}>Version</Label>
          <Input id={`${id}-version`} value={draft.version} placeholder="1.0.0" className="font-mono" onChange={(e) => set({ version: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-author`}>Author <span className="font-normal text-muted-foreground">(optional)</span></Label>
          <Input id={`${id}-author`} value={draft.author} placeholder="Your name or handle" onChange={(e) => set({ author: e.target.value })} />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor={`${id}-description`}>What it is for <span className="font-normal text-muted-foreground">(optional)</span></Label>
          <Textarea id={`${id}-description`} rows={2} value={draft.description} placeholder="How a live-coding stream becomes shorts: the split-screen template, the outro rule and the names." onChange={(e) => set({ description: e.target.value })} />
        </div>
      </Panel>

      <div className="grid gap-4 sm:grid-cols-2">
        <Panel as="fieldset" className="flex flex-col gap-2">
          <legend className="sr-only">Templates</legend>
          <PanelHeading title="Templates">Yours. Built-in templates are on every machine already.</PanelHeading>
          {yours.length ? yours.map((t) => <Checkbox key={t.id} className="min-h-8 text-sm" checked={draft.templates.has(t.id)} onCheckedChange={(on) => toggle("templates", t.id, on)}>{t.name}</Checkbox>) : <p className="text-xs text-muted-foreground">No templates of your own yet.</p>}
        </Panel>
        <Panel as="fieldset" className="flex flex-col gap-2">
          <legend className="sr-only">Rules</legend>
          <PanelHeading title="Rules" />
          {rules.length ? rules.map((r) => <Checkbox key={r.id} className="min-h-8 text-sm" checked={draft.rules.has(r.id)} onCheckedChange={(on) => toggle("rules", r.id, on)}>{r.name}</Checkbox>) : <p className="text-xs text-muted-foreground">No rules yet.</p>}
        </Panel>
      </div>

      <Panel as="fieldset" className="flex flex-col gap-3">
        <legend className="sr-only">Assets</legend>
        <PanelHeading title="Assets">A rule that fills a template&apos;s slot with a library file needs the file to travel with it.</PanelHeading>
        {(["video", "image", "audio"] as const).map((kind) => named(kind).length ? (
          <div key={kind} className="flex flex-col gap-1">
            <p className="text-xs font-medium text-muted-foreground">{kind === "video" ? "Video" : kind === "image" ? "Images" : "Sounds"}</p>
            <div className="grid gap-x-4 sm:grid-cols-2">
              {named(kind).map((a) => <Checkbox key={a.id} className="min-h-8 text-sm" checked={draft.assets.has(a.id)} onCheckedChange={(on) => toggle("assets", a.id, on)}><span className="truncate">{a.name}</span></Checkbox>)}
            </div>
          </div>
        ) : null)}
        {!data.assets.length && <p className="text-xs text-muted-foreground">The library is empty.</p>}
      </Panel>

      <div className="grid gap-4 sm:grid-cols-2">
        <Panel as="fieldset" className="flex flex-col gap-2">
          <legend className="sr-only">Names and quick actions</legend>
          <PanelHeading title="Names and quick actions" />
          <Checkbox className="min-h-8 text-sm" checked={draft.glossary} onCheckedChange={(glossary) => set({ glossary })}>Include the glossary ({count(data.glossary.terms.length, "name")})</Checkbox>
          {quickActions.map((a) => <Checkbox key={a.key} className="min-h-8 text-sm" checked={draft.quickActions.has(a.key)} onCheckedChange={(on) => toggle("quickActions", a.key, on)}><span>{a.label} <span className="text-xs text-muted-foreground">· from {a.pack}</span></span></Checkbox>)}
        </Panel>
        <Panel as="fieldset" className="flex flex-col gap-2">
          <legend className="sr-only">Style guide</legend>
          <PanelHeading title="Style guide and standard">Copied from an installed pack: its guide, its references and what it holds videos to.</PanelHeading>
          <Select value={draft.stylePack} onValueChange={(v) => set({ stylePack: String(v) })}>
            <SelectTrigger aria-label="Style guide to include" className="w-full"><SelectValue>{(v: unknown) => styleLabel(String(v ?? ""))}</SelectValue></SelectTrigger>
            <SelectContent>
              <SelectItem value="">None</SelectItem>
              {styled.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </Panel>
      </div>

      <ErrorLine>{error}</ErrorLine>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending === "export" || !draft.id.trim()}>{pending === "export" ? <Loader2 aria-hidden className="motion-safe:animate-spin" /> : <Upload aria-hidden />}Export</Button>
        <Button type="button" variant="ghost" onClick={onBack}>Cancel</Button>
      </div>
    </form>
  );
}
