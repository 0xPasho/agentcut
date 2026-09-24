"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Loader2, Trash2, Upload } from "lucide-react";
import { Button } from "@/common/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/common/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose, DialogTrigger } from "@/common/ui/dialog";
import { api, assetFileUrl, type AssetSummary } from "@/common/api/client";
import { classifyFile, hasFileDrag } from "@/modules/editor/lib/dnd";
import type { InstalledPack } from "@/modules/packs/types";
import { Empty, ErrorLine, Loading, SectionHeader } from "@/modules/settings/components/section-header";
import { assetOrigin, seconds } from "@/modules/settings/lib";
import type { LibraryKind as Kind } from "./types";
import { LIBRARY_KINDS as KINDS } from "./data";


/**
 * The library: the media that belongs to every project. It lives in the workspace
 * shell beside the rules and packs that name its files (decision 130), and keeps
 * its media and nothing else. Anything the button adds can be dropped in instead,
 * and anything dropped into the folder by hand is picked up on the next look.
 */
export function LibraryView({ packs, onChanged }: { packs: InstalledPack[]; onChanged?: () => void }) {
  const [kind, setKind] = useState<Kind>("image");
  const [assets, setAssets] = useState<AssetSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [pending, start] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback((k: Kind) => {
    start(async () => {
      try { setAssets((await api.listAssets(k, "")).assets); }
      catch (e) { setError((e as Error).message); }
    });
  }, []);

  useEffect(() => load(kind), [kind, load]);

  const upload = (chosen: File[] | FileList | null) => {
    const files = Array.from(chosen ?? []).filter((file) => classifyFile(file.name) !== null);
    if (!files.length) {
      setError("The library holds images, sounds and reusable video: intros, outros, stings, b-roll.");
      return;
    }
    setError(null);
    start(async () => {
      try {
        for (const file of files) await api.uploadAsset(file);
        setAssets((await api.listAssets(kind, "")).assets);
        // The count in the rail, and the assets a rule can name.
        onChanged?.();
      } catch (e) {
        setError((e as Error).message);
      }
    });
  };

  /** Throws on refusal, so the dialog that asked stays open and says why. */
  const remove = async (id: string) => {
    await api.deleteAsset(id);
    setError(null);
    setAssets((prev) => (prev ?? []).filter((a) => a.id !== id));
    onChanged?.();
  };

  const uploadButton = (
    <Button size="sm" disabled={pending} onClick={() => fileInput.current?.click()}>
      {pending ? <Loader2 className="size-4 motion-safe:animate-spin" /> : <Upload className="size-4" />}Upload
    </Button>
  );

  return (
    <section
      className="flex flex-col gap-5"
      onDragEnter={(e) => { if (hasFileDrag(Array.from(e.dataTransfer.types))) setDragging(true); }}
      onDragOver={(e) => {
        if (!hasFileDrag(Array.from(e.dataTransfer.types))) return;
        e.preventDefault(); e.dataTransfer.dropEffect = "copy"; setDragging(true);
      }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false); }}
      onDrop={(e) => {
        if (!hasFileDrag(Array.from(e.dataTransfer.types))) return;
        e.preventDefault(); setDragging(false); upload(Array.from(e.dataTransfer.files));
      }}
    >
      {dragging && (
        <div aria-hidden className="pointer-events-none fixed inset-0 z-50 flex justify-center p-4">
          <div className="absolute inset-2 rounded-3xl border-2 border-dashed border-primary/70 bg-primary/5" />
          <p className="relative mt-3 h-fit rounded-full bg-black/85 px-4 py-2 text-sm text-white shadow-lg">Drop images, sounds or video to add them to your library</p>
        </div>
      )}

      <SectionHeader title="Library" action={uploadButton}>
        Images, sounds and reusable video — intros, outros, stings, b-roll — for every project. A rule
        can hand one to a template, and a pack carries the ones it names.
      </SectionHeader>

      <input ref={fileInput} type="file" multiple accept="image/*,audio/*,video/*" className="hidden" onChange={(e) => upload(e.target.files)} />

      <Tabs value={kind} onValueChange={(v) => setKind(v as Kind)}>
        <TabsList aria-label="Kind of file">
          {KINDS.map((k) => <TabsTrigger key={k.kind} value={k.kind}>{k.label}</TabsTrigger>)}
        </TabsList>

        {KINDS.map((k) => (
          <TabsContent key={k.kind} value={k.kind} className="pt-5">
            {assets === null && <Loading label={`Loading your ${k.plural}`} />}
            {assets !== null && assets.length > 0 && <Grid kind={k.kind} assets={assets} origin={(a) => assetOrigin(a.source, packs)} onRemove={remove} />}
            {assets !== null && assets.length === 0 && (
              <Empty title={`No ${k.plural} yet`} action={uploadButton}>
                {k.kind === "image" && "Logos, end cards, the pictures a template can hold full-frame. Drop them here or choose Upload."}
                {k.kind === "audio" && "Stings, beds and the sounds a template cues. Drop them here or choose Upload."}
                {k.kind === "video" && "Intros, outros and b-roll that end up in more than one video. Drop them here or choose Upload."}
              </Empty>
            )}
          </TabsContent>
        ))}
      </Tabs>

      <ErrorLine>{error}</ErrorLine>

      <p className="text-xs text-muted-foreground">
        Anything dropped into <code className="font-mono">workspace/library/</code> is picked up automatically.
        Deleting a file here deletes it from that folder.
      </p>
    </section>
  );
}

function Grid({ kind, assets, origin, onRemove }: { kind: Kind; assets: AssetSummary[]; origin: (a: AssetSummary) => string; onRemove: (id: string) => Promise<void> }) {
  if (kind === "image") return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {assets.map((a) => (
        <li key={a.id} className="flex flex-col overflow-hidden rounded-2xl bg-card ring-1 ring-foreground/10">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={assetFileUrl(a.id)} alt="" loading="lazy" className="aspect-square w-full bg-black/30 object-cover outline-1 -outline-offset-1 outline-white/10" />
          <div className="flex items-center gap-2 px-3 py-2">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs" title={a.name}>{a.name}</span>
              <Meta asset={a} origin={origin(a)} />
            </span>
            <DeleteAsset asset={a} onRemove={onRemove} />
          </div>
        </li>
      ))}
    </ul>
  );

  if (kind === "audio") return (
    <ul className="flex flex-col gap-2">
      {assets.map((a) => (
        <li key={a.id} className="flex flex-row flex-wrap items-center gap-3 rounded-2xl bg-card px-4 py-3 ring-1 ring-foreground/10">
          <div className="min-w-0 flex-1">
            <p className="break-words text-sm font-medium">{a.name}</p>
            <Meta asset={a} origin={origin(a)} />
          </div>
          <audio controls preload="none" src={assetFileUrl(a.id)} aria-label={`Preview ${a.name}`} className="order-last h-9 w-full sm:order-none sm:max-w-[240px]" />
          <DeleteAsset asset={a} onRemove={onRemove} />
        </li>
      ))}
    </ul>
  );

  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {assets.map((a) => (
        <li key={a.id} className="flex flex-col gap-2 rounded-2xl bg-card p-3 ring-1 ring-foreground/10">
          <video controls preload="metadata" src={assetFileUrl(a.id)} aria-label={`Preview ${a.name}`} className="aspect-video w-full rounded-lg bg-black object-contain" />
          <div className="flex items-center gap-2 px-1">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium" title={a.name}>{a.name}</p>
              <Meta asset={a} origin={origin(a)} />
            </div>
            <DeleteAsset asset={a} onRemove={onRemove} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** One muted line: where it came from, how big, how long, and its licence when it has one. */
function Meta({ asset, origin }: { asset: AssetSummary; origin: string }) {
  const parts = [
    origin,
    asset.width && asset.height ? `${asset.width}×${asset.height}` : "",
    asset.duration_sec ? seconds(asset.duration_sec) : "",
    asset.license ?? "",
  ].filter(Boolean);
  if (!parts.length) return null;
  return <span className="block truncate font-mono text-[11px] text-muted-foreground" title={parts.join(" · ")}>{parts.join(" · ")}</span>;
}

function DeleteAsset({ asset, onRemove }: { asset: AssetSummary; onRemove: (id: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remove = async () => {
    setPending(true);
    setError(null);
    try {
      await onRemove(asset.id);
      setOpen(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!pending) { setOpen(next); setError(null); } }}>
      <DialogTrigger render={<Button size="icon-sm" variant="ghost" aria-label={`Delete ${asset.name}`} />}>
        <Trash2 aria-hidden className="size-4" />
      </DialogTrigger>
      <DialogContent showCloseButton={!pending}>
        <DialogHeader>
          <DialogTitle>Delete this file?</DialogTitle>
          <DialogDescription className="break-words">
            “{asset.name}” is removed from the library and its file is deleted from the workspace folder.
            A template or a rule that still names it stops this, and says which.
          </DialogDescription>
        </DialogHeader>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <DialogClose render={<Button variant="outline" disabled={pending} />}>Cancel</DialogClose>
          <Button variant="destructive" disabled={pending} onClick={remove}>
            {pending && <Loader2 aria-hidden className="motion-safe:animate-spin" />}
            {pending ? "Deleting…" : "Delete file"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
