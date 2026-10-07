"use client";

import { useRef, useState, useTransition } from "react";
import { Loader2, Search, Upload, X } from "lucide-react";
import { Button } from "@/common/ui/button";
import { Input } from "@/common/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/common/ui/tabs";
import { api } from "@agentcut/core/common/api/client";
import { ingestFiles } from "@agentcut/core/common/api/ingest";
import { classifyFile, hasFileDrag } from "@agentcut/core/modules/editor/lib/dnd";
import type { InstalledPack } from "@agentcut/core/modules/packs/types";
import { Empty, ErrorLine, Loading, SectionHeader } from "@/modules/settings/components/section-header";
import { assetOrigin } from "@agentcut/core/modules/settings/lib";
import type { LibraryKind } from "@agentcut/core/modules/media/types";
import { LIBRARY_KINDS } from "@agentcut/core/modules/media/data";
import { useLibraryAssets } from "./hooks";
import { LibraryAssetCard } from "./components/library-asset-card";

/** Workspace media: inspect a file here; place it from the same library in the editor. */
export function LibraryView({ packs, onChanged }: { packs: InstalledPack[]; onChanged?: () => void }) {
  const [kind, setKind] = useState<LibraryKind>("image");
  const [query, setQuery] = useState("");
  const { assets, setAssets, error: loadError, loading, reload } = useLibraryAssets();
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [pending, start] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const needle = query.trim().toLocaleLowerCase();
  const matchingKind = (assets ?? []).filter((asset) => asset.kind === kind);
  const shown = matchingKind.filter((asset) =>
    `${asset.name} ${asset.tags ?? ""} ${assetOrigin(asset.source, packs)}`.toLocaleLowerCase().includes(needle));

  const upload = (chosen: File[] | FileList | null) => {
    const files = Array.from(chosen ?? []).filter((file) => classifyFile(file.name) !== null);
    if (!files.length) {
      setError("Choose images, sounds or video to add to the library.");
      return;
    }
    setError(null);
    start(async () => {
      try {
        await ingestFiles(files, { library: true });
        await reload();
        onChanged?.();
      } catch (e) {
        setError((e as Error).message);
      }
    });
  };

  const remove = async (id: string) => {
    await api.deleteAsset(id);
    setError(null);
    setAssets((previous) => (previous ?? []).filter((asset) => asset.id !== id));
    onChanged?.();
  };

  const clearSearch = () => { setQuery(""); searchInput.current?.focus(); };
  const uploadButton = (
    <Button disabled={pending} onClick={() => fileInput.current?.click()}>
      {pending ? <Loader2 aria-hidden className="motion-safe:animate-spin" /> : <Upload aria-hidden />}
      {pending ? "Uploading…" : "Upload files"}
    </Button>
  );

  return (
    <section
      className="flex min-w-0 flex-col gap-6"
      onDragEnter={(e) => { if (hasFileDrag(Array.from(e.dataTransfer.types))) setDragging(true); }}
      onDragOver={(e) => {
        if (!hasFileDrag(Array.from(e.dataTransfer.types))) return;
        e.preventDefault(); e.dataTransfer.dropEffect = "copy"; setDragging(true);
      }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false); }}
      onDrop={(e) => {
        if (!hasFileDrag(Array.from(e.dataTransfer.types))) return;
        e.preventDefault(); setDragging(false);
        if (!pending) upload(Array.from(e.dataTransfer.files));
      }}
    >
      {dragging && (
        <div aria-hidden className="pointer-events-none fixed inset-0 z-50 flex justify-center p-4">
          <div className="absolute inset-2 rounded-3xl border-2 border-dashed border-primary/70 bg-primary/5" />
          <p className="relative mt-3 h-fit rounded-full bg-black/85 px-4 py-2 text-sm text-white shadow-lg">Drop files to add them to your library</p>
        </div>
      )}

      <SectionHeader title="Library" action={uploadButton}>
        Your reusable media, across every project. Open a file to preview it.
      </SectionHeader>
      <input ref={fileInput} type="file" multiple accept="image/*,audio/*,video/*" className="hidden"
        onChange={(e) => { if (e.target.files?.length) upload(e.target.files); e.target.value = ""; }} />

      <Tabs value={kind} onValueChange={(value) => setKind(value as LibraryKind)} className="min-w-0 gap-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <TabsList aria-label="Kind of file">
            {LIBRARY_KINDS.map((tab) => (
              <TabsTrigger key={tab.kind} value={tab.kind} className="gap-2">
                {tab.label}
                {assets && <span className="text-xs text-muted-foreground tabular-nums">{assets.filter((asset) => asset.kind === tab.kind).length}</span>}
              </TabsTrigger>
            ))}
          </TabsList>
          <div className="relative w-full sm:max-w-xs">
            <Search aria-hidden className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input ref={searchInput} type="search" aria-label="Search library" placeholder="Search files…"
              value={query} onChange={(e) => setQuery(e.target.value)} className="ps-9 pe-10" />
            {query && <Button type="button" size="icon-sm" variant="ghost" aria-label="Clear search"
              className="absolute end-1 top-1/2 -translate-y-1/2" onClick={clearSearch}><X aria-hidden /></Button>}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <p role="status">{assets && `${shown.length} ${shown.length === 1 ? "file" : "files"}${needle ? ` matching “${query.trim()}”` : ""}`}</p>
          <p>Open to preview · Use in any project</p>
        </div>

        {LIBRARY_KINDS.map((tab) => (
          <TabsContent key={tab.kind} value={tab.kind}>
            {assets === null && loading && <Loading label="Loading your library" />}
            {assets !== null && shown.length > 0 && (
              <ul className="grid grid-cols-1 gap-4 min-[420px]:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {shown.map((asset) => <LibraryAssetCard key={asset.id} asset={asset} origin={assetOrigin(asset.source, packs)} onRemove={remove} />)}
              </ul>
            )}
            {assets !== null && shown.length === 0 && needle && (
              <Empty title={`No ${tab.plural} match “${query.trim()}”`} action={<Button variant="outline" onClick={clearSearch}>Clear search</Button>}>
                Try another name, or switch to a different file type.
              </Empty>
            )}
            {assets !== null && matchingKind.length === 0 && !needle && (
              <Empty title={`No ${tab.plural} yet`} action={<Button variant="outline" disabled={pending} onClick={() => fileInput.current?.click()}><Upload aria-hidden />Choose files</Button>}>
                Drop {tab.plural} here to reuse them in any project.
              </Empty>
            )}
          </TabsContent>
        ))}
      </Tabs>
      <ErrorLine>{error || loadError}</ErrorLine>
      {loadError && <Button variant="outline" className="self-start" disabled={loading} onClick={() => void reload()}>Retry loading library</Button>}
      <p className="max-w-prose text-xs text-muted-foreground">To add a file to a video, open Library in the editor’s media panel.</p>
    </section>
  );
}
