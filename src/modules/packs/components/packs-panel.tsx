"use client";
import { useCallback, useEffect, useId, useState } from "react";
import { Download, Loader2, Package, Trash2 } from "lucide-react";
import { api } from "@/common/api/client";
import type { InstalledPack } from "@/modules/packs/types";
import type { PackPreview } from "@/modules/packs/server/packs";
import { Badge } from "../../../common/ui/badge";
import { Button } from "../../../common/ui/button";
import { Checkbox } from "@/common/ui/checkbox";
import { Input } from "../../../common/ui/input";
import { Label } from "../../../common/ui/label";
import { Disclosure } from "@/common/ui/disclosure";
import { StyleEditor } from "./style-editor";

/**
 * Packs: what travels between people. Import shows everything a pack carries before
 * anything is installed — the rules' text most of all, because an agent will read
 * it. Export writes a folder from this workspace that any static host can serve.
 */
export function PacksPanel() {
  const id = useId();
  const [packs, setPacks] = useState<InstalledPack[]>([]);
  const [templates, setTemplates] = useState<Array<{ id: string; name: string; builtin: boolean }>>([]);
  const [rules, setRules] = useState<Array<{ id: string; name: string }>>([]);
  const [source, setSource] = useState("");
  const [preview, setPreview] = useState<PackPreview | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [exportForm, setExportForm] = useState({ id: "", name: "", templates: new Set<string>(), rules: new Set<string>(), glossary: true });

  const load = useCallback(async () => {
    try {
      const w = await api.workspace<{ packs: InstalledPack[]; templates: Array<{ id: string; name: string; builtin: boolean }>; rules: Array<{ id: string; name: string }> }>();
      setPacks(w.packs); setTemplates(w.templates); setRules(w.rules);
    } catch (e) { setError((e as Error).message); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const run = async (label: string, fn: () => Promise<string>) => {
    setBusy(label); setError(""); setNotice("");
    try { setNotice(await fn()); await load(); } catch (e) { setError((e as Error).message); } finally { setBusy(""); }
  };

  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <h3 className="text-sm font-medium">Installed</h3>
        {packs.length ? <ul className="space-y-2">{packs.map((p) => <li key={p.id} className="flex items-start gap-2 rounded-xl border border-border p-3 text-sm">
          <Package className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <p className="font-medium">{p.name} <span className="text-xs text-muted-foreground">v{p.version}{p.author ? ` · ${p.author}` : ""}</span></p>
            <p className="truncate text-xs text-muted-foreground" title={p.source}>{p.source}</p>
            <p className="text-xs text-muted-foreground">{[p.examples.length && `${p.examples.length} reference${p.examples.length === 1 ? "" : "s"}`, p.templates.length && `${p.templates.length} template${p.templates.length === 1 ? "" : "s"}`, p.rules.length && `${p.rules.length} rule${p.rules.length === 1 ? "" : "s"}`, Object.keys(p.assets).length && `${Object.keys(p.assets).length} asset${Object.keys(p.assets).length === 1 ? "" : "s"}`, p.glossary.length && `${p.glossary.length} glossary term${p.glossary.length === 1 ? "" : "s"}`, p.quickActions.length && `${p.quickActions.length} quick action${p.quickActions.length === 1 ? "" : "s"}`].filter(Boolean).join(" · ") || "nothing new"}</p>
            <Disclosure variant="plain" summary="Style guide and references" className="mt-2"><StyleEditor packId={p.id} /></Disclosure>
          </div>
          <Button size="icon-sm" variant="ghost" aria-label={`Remove pack ${p.name}`} disabled={!!busy} onClick={() => run(`remove:${p.id}`, async () => { await api.workspace({ action: "packs.remove", id: p.id }); return `Removed ${p.name}. Its assets stay in the library.`; })}><Trash2 /></Button>
        </li>)}</ul> : <p className="text-xs text-muted-foreground">No packs yet. Import one by path or URL, or export your own below.</p>}
      </section>

      <section className="space-y-2">
        <Label htmlFor={`${id}-source`}>Import a pack</Label>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void run("inspect", async () => { setPreview(await api.workspace<PackPreview>({ action: "packs.inspect", source })); return ""; }); }}>
          <Input id={`${id}-source`} value={source} placeholder="https://example.com/packs/streamer-kit/pack.json or ~/Downloads/streamer-kit" onChange={(e) => { setSource(e.target.value); setPreview(null); }} />
          <Button type="submit" variant="outline" disabled={!source.trim() || !!busy}>{busy === "inspect" ? <Loader2 className="motion-safe:animate-spin" /> : null}Read it</Button>
        </form>
        {preview && <div className="space-y-3 rounded-xl border border-border p-3 text-sm">
          <div className="flex items-center gap-2"><p className="flex-1 font-medium">{preview.manifest.name} <span className="text-xs text-muted-foreground">v{preview.manifest.version}{preview.manifest.author ? ` · ${preview.manifest.author}` : ""}</span></p><Badge variant="destructive" className="text-[10px]">Untrusted until you read it</Badge></div>
          {preview.manifest.description && <p className="text-xs text-muted-foreground">{preview.manifest.description}</p>}
          {!!preview.templates.length && <div><p className="text-xs font-medium">Templates</p><ul className="text-xs text-muted-foreground">{preview.templates.map((t) => <li key={t.id}>{t.name}{t.extends ? ` (extends ${t.extends})` : ""}{t.exists ? " — you already have one with this id; it is kept unless you replace" : ""}{t.missingParent ? ` — it builds on “${t.missingParent}”, which is not on this machine, so it will not appear until that is` : ""}</li>)}</ul></div>}
          {!!preview.rules.length && <div><p className="text-xs font-medium">Rules — text an agent will follow</p><ul className="space-y-1 text-xs">{preview.rules.map((r) => <li key={r.id} className="rounded-lg border border-destructive/30 bg-destructive/5 p-2"><span className="font-medium">{r.name}</span> · when {r.when}{r.prompt ? <pre className="mt-1 whitespace-pre-wrap font-sans text-muted-foreground">{r.prompt}</pre> : null}{r.exists ? <span className="block text-muted-foreground">You already have this id.</span> : null}</li>)}</ul></div>}
          {!!preview.style.text && <div><p className="text-xs font-medium">Style guide — the agents read this before choosing and editing</p><pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-lg border border-destructive/30 bg-destructive/5 p-2 text-xs">{preview.style.text}</pre></div>}
          {!!preview.examples.length && <p className="text-xs text-muted-foreground">{preview.examples.length} reference video{preview.examples.length === 1 ? "" : "s"}: {preview.examples.map((e) => e.title || e.file).join(", ")}</p>}
          {!!preview.style.problems.length && <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">This pack will not install: {preview.style.problems.map((p) => (p.line ? `line ${p.line} ${p.why}` : `its guide ${p.why}`)).join("; ")}.</p>}
          {!!preview.quickActions.length && <div><p className="text-xs font-medium">Quick actions — messages sent to the agent</p><ul className="space-y-1 text-xs">{preview.quickActions.map((a) => <li key={a.label} className="rounded-lg border border-destructive/30 bg-destructive/5 p-2"><span className="font-medium">{a.label}</span>: {a.text}</li>)}</ul></div>}
          {!!preview.assets.length && <p className="text-xs text-muted-foreground">Assets: {preview.assets.map((a) => `${a.name} (${a.kind})`).join(", ")}</p>}
          {!!preview.manifest.glossary.length && <p className="text-xs text-muted-foreground">Glossary: {preview.manifest.glossary.map((g) => g.term).join(", ")}</p>}
          <div className="flex gap-2">
            <Button size="sm" disabled={!!busy} onClick={() => run("import", async () => { const p = await api.workspace<InstalledPack>({ action: "packs.import", source }); setPreview(null); return `Installed ${p.name}.`; })}>{busy === "import" ? <Loader2 className="motion-safe:animate-spin" /> : <Download />}Install</Button>
            {(preview.templates.some((t) => t.exists) || preview.rules.some((r) => r.exists)) && <Button size="sm" variant="outline" disabled={!!busy} onClick={() => run("import", async () => { const p = await api.workspace<InstalledPack>({ action: "packs.import", source, replace: true }); setPreview(null); return `Installed ${p.name}, replacing what you had.`; })}>Install and replace mine</Button>}
          </div>
        </div>}
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-medium">Export a pack</h3>
        <form className="space-y-2" onSubmit={(e) => {
          e.preventDefault();
          void run("export", async () => {
            const result = await api.workspace<{ dir: string }>({ action: "packs.export", pack: { id: exportForm.id.trim(), name: exportForm.name.trim() || exportForm.id.trim(), templates: [...exportForm.templates], rules: [...exportForm.rules], glossary: exportForm.glossary } });
            return `Written to ${result.dir}. Serve that folder from any static host, or send it as is.`;
          });
        }}>
          <div className="grid gap-2 sm:grid-cols-2">
            <Input aria-label="Pack id" required pattern="[a-z0-9][a-z0-9\-]*" placeholder="streamer-kit" value={exportForm.id} onChange={(e) => setExportForm({ ...exportForm, id: e.target.value })} />
            <Input aria-label="Pack name" placeholder="Streamer kit" value={exportForm.name} onChange={(e) => setExportForm({ ...exportForm, name: e.target.value })} />
          </div>
          <div className="grid gap-2 sm:grid-cols-2 text-xs">
            <fieldset className="space-y-1"><legend className="font-medium">Templates</legend>{templates.filter((t) => !t.builtin).map((t) => <Checkbox key={t.id} className="flex w-full text-xs" checked={exportForm.templates.has(t.id)} onCheckedChange={(on) => { const next = new Set(exportForm.templates); if (on) next.add(t.id); else next.delete(t.id); setExportForm({ ...exportForm, templates: next }); }}>{t.name}</Checkbox>)}{!templates.some((t) => !t.builtin) && <p className="text-muted-foreground">No templates of your own yet.</p>}</fieldset>
            <fieldset className="space-y-1"><legend className="font-medium">Rules</legend>{rules.map((r) => <Checkbox key={r.id} className="flex w-full text-xs" checked={exportForm.rules.has(r.id)} onCheckedChange={(on) => { const next = new Set(exportForm.rules); if (on) next.add(r.id); else next.delete(r.id); setExportForm({ ...exportForm, rules: next }); }}>{r.name}</Checkbox>)}{!rules.length && <p className="text-muted-foreground">No rules yet.</p>}</fieldset>
          </div>
          <Checkbox className="text-xs" checked={exportForm.glossary} onCheckedChange={(glossary) => setExportForm({ ...exportForm, glossary })}>Include the glossary</Checkbox>
          <Button size="sm" type="submit" variant="outline" disabled={!!busy || !exportForm.id.trim()}>{busy === "export" ? <Loader2 className="motion-safe:animate-spin" /> : null}Export</Button>
        </form>
      </section>
      {notice && <p role="status" className="text-xs text-muted-foreground">{notice}</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
