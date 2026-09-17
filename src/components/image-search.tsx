"use client";

import { useState, useTransition } from "react";
import { Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, type AssetSummary, type SearchHit } from "@/lib/client";

/**
 * Concrete named things come back clean; abstract phrases return nothing, which
 * is the intended answer — an irrelevant image is worse than no image.
 */
export function ImageSearch({
  projectId,
  onAdopt,
}: {
  projectId: string;
  onAdopt: (asset: AssetSummary) => void;
}) {
  const [query, setQuery] = useState("");
  const [searchedQuery, setSearchedQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adopting, setAdopting] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const run = () => {
    if (!query.trim()) return;
    setError(null);
    start(async () => {
      try {
        setHits(await api.editorTool<SearchHit[]>(projectId, { tool: "assets.search", query }));
        setSearchedQuery(query);
      } catch (e) {
        setError((e as Error).message);
      }
    });
  };

  const adopt = (hit: SearchHit) => {
    setAdopting(hit.id);
    void (async () => {
      try {
        const asset = await api.editorTool<AssetSummary>(projectId, { tool: "assets.adopt", query: searchedQuery, provider: hit.provider, id: hit.id });
        onAdopt(asset);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setAdopting(null);
      }
    })();
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <Input aria-label="Search images"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && run()}
          placeholder="Something nameable: proxmox, macbook air…"
        />
        <Button aria-label="Search images" variant="outline" disabled={pending || !query.trim()} onClick={run}>
          {pending ? <Loader2 className="size-4 motion-safe:animate-spin" /> : <Search className="size-4" />}
        </Button>
      </div>

      {error ? <p className="text-xs text-destructive">{error}</p> : null}

      {hits?.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Nothing relevant enough. Search works for things with a name — a product, a company, a
          place, an interface — not for concepts.
        </p>
      ) : null}

      {hits?.length ? (
        <div className="grid grid-cols-3 gap-2">
          {hits.map((hit) => (
            <button
              key={`${hit.provider}-${hit.id}`}
              type="button"
              onClick={() => adopt(hit)}
              disabled={adopting !== null}
              aria-label={`Add ${hit.title}`}
              title={`${hit.title} · ${hit.license}`}
              className="group relative overflow-hidden rounded-xl border border-border outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={hit.thumbUrl} alt="" className="aspect-square w-full object-cover" />
              {adopting === hit.id ? (
                <span className="absolute inset-0 grid place-items-center bg-black/60">
                  <Loader2 className="size-4 motion-safe:animate-spin" />
                </span>
              ) : null}
              <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/90 to-transparent px-1.5 pt-4 pb-1 text-left text-[10px] text-white/80">
                {hit.license}
              </span>
            </button>
          ))}
        </div>
      ) : null}

      {hits?.length ? (
        <p className="text-[11px] text-muted-foreground">
          Credit lines are saved automatically and exported with the clips.
        </p>
      ) : null}
    </div>
  );
}
