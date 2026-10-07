"use client";
import { useEffect, useId, useState } from "react";
import { Code2, Download, Images, LayoutTemplate, ListChecks, Loader2, Search, Store } from "lucide-react";
import { api } from "@agentcut/core/common/api/client";
import type { MarketPack, MarketSearchResult } from "@agentcut/core/modules/packs/types";
import { count } from "@agentcut/core/modules/settings/lib";
import { Button } from "@/common/ui/button";
import { Input } from "@/common/ui/input";
import { Label } from "@/common/ui/label";
import { ErrorLine, Panel, PanelHeading } from "./section-header";

type MarketSearchProps = { selected: string; onPick: (source: string) => void };

/**
 * The marketplace, inside the import flow. Picking a pack only fills in its URL and reads
 * it: the preview below, the untrusted warnings and the install button are the ones a pack
 * typed by hand gets, because a marketplace pack is just a URL (packs.search → packs.inspect).
 */
export function MarketSearch({ selected, onPick }: MarketSearchProps) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<MarketSearchResult | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const found = await api.workspace<MarketSearchResult>({ action: "packs.search", query });
        if (live) { setResult(found); setError(""); }
      } catch (e) {
        if (live) setError((e as Error).message);
      } finally {
        if (live) setLoading(false);
      }
    }, query ? 250 : 0);
    return () => { live = false; clearTimeout(timer); };
  }, [query]);

  const host = result ? new URL(result.market).host : "";

  return (
    <Panel className="flex flex-col gap-3">
      <PanelHeading title="Marketplace" icon={<Store aria-hidden className="size-4" />}>
        Packs other people publish{host ? ` on ${host}` : ""}. Reading one installs nothing.
      </PanelHeading>
      <div className="relative">
        <Label htmlFor={`${id}-q`} className="sr-only">Search the marketplace</Label>
        <Search aria-hidden className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input id={`${id}-q`} type="search" value={query} autoFocus className="ps-9" placeholder="Search by name or description" onChange={(e) => setQuery(e.target.value)} />
      </div>
      <ErrorLine>{error}</ErrorLine>
      {loading && !result && <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 aria-hidden className="size-3.5 motion-safe:animate-spin" />Looking…</p>}
      {result && !result.packs.length && <p className="text-sm text-muted-foreground">{query ? "Nothing matches." : "Nobody has published a pack yet."}</p>}
      {!!result?.packs.length && (
        <ul className="flex flex-col gap-1.5" aria-busy={loading}>
          {result.packs.map((pack) => <MarketRow key={pack.name} pack={pack} active={selected === pack.source} onPick={onPick} />)}
        </ul>
      )}
    </Panel>
  );
}

function MarketRow({ pack, active, onPick }: { pack: MarketPack; active: boolean; onPick: (source: string) => void }) {
  const parts = [
    pack.counts.templates ? { icon: LayoutTemplate, text: count(pack.counts.templates, "template") } : null,
    pack.counts.rules ? { icon: ListChecks, text: count(pack.counts.rules, "rule") } : null,
    pack.counts.assets ? { icon: Images, text: count(pack.counts.assets, "asset") } : null,
    pack.counts.recipes ? { icon: Code2, text: count(pack.counts.recipes, "recipe") } : null,
  ].filter((p) => p !== null);
  return (
    <li className={`flex items-center gap-3 rounded-2xl px-3 py-2.5 ring-1 transition-colors ${active ? "bg-primary/10 ring-primary/40" : "ring-foreground/10 hover:bg-foreground/5"}`}>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{pack.title} <span className="font-mono text-xs font-normal text-muted-foreground">{pack.name} v{pack.latest}</span></p>
        <p className="line-clamp-1 text-xs text-muted-foreground">{pack.description}</p>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>{pack.owner.login}</span>
          {parts.map(({ icon: Icon, text }) => <span key={text} className="inline-flex items-center gap-1"><Icon aria-hidden className="size-3.5" />{text}</span>)}
          <span className="inline-flex items-center gap-1 tabular-nums"><Download aria-hidden className="size-3.5" />{pack.downloads}</span>
        </p>
      </div>
      <Button type="button" size="sm" variant={active ? "default" : "outline"} onClick={() => onPick(pack.source)}>{active ? "Reading" : "Read it"}</Button>
    </li>
  );
}
