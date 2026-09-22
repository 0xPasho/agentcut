"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Settings, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Glass } from "@/components/ui/glass";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose, DialogTrigger } from "@/components/ui/dialog";
import { api, assetFileUrl, type AssetSummary } from "@/lib/client";
import { classifyFile, hasFileDrag } from "@/lib/editor/dnd";

export function LibraryView() {
  const [kind, setKind] = useState<"image" | "audio" | "video">("image");
  const [assets, setAssets] = useState<AssetSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [pending, start] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(
    (k: "image" | "audio" | "video") => {
      start(async () => {
        try {
          setAssets((await api.listAssets(k, "")).assets);
        } catch (e) {
          setError((e as Error).message);
        }
      });
    },
    [],
  );

  useEffect(() => load(kind), [kind, load]);

  const upload = (chosen: File[] | FileList | null) => {
    const files = Array.from(chosen ?? []).filter((file) => {
      return classifyFile(file.name) !== null;
    });
    if (!files.length) {
      setError("The library holds images, sounds and reusable video: intros, outros, stings, b-roll.");
      return;
    }
    setError(null);
    start(async () => {
      try {
        for (const file of files) await api.uploadAsset(file);
        setAssets((await api.listAssets(kind, "")).assets);
      } catch (e) {
        setError((e as Error).message);
      }
    });
  };

  const remove = async (id: string) => {
    // Refused when a template or a rule still names it, which is a sentence worth
    // reading rather than a row that stays put for no visible reason.
    try {
      await api.deleteAsset(id);
      setError(null);
      setAssets((prev) => prev.filter((a) => a.id !== id));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <main
      className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-6 px-4 sm:px-6 pt-4 pb-14"
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
      {/* Anything you can add with the button can be dropped in instead. */}
      {dragging && (
        <div aria-hidden className="pointer-events-none fixed inset-0 z-50 flex justify-center p-4">
          <div className="absolute inset-2 rounded-3xl border-2 border-dashed border-primary/70 bg-primary/5" />
          <p className="relative mt-3 h-fit rounded-full bg-black/85 px-4 py-2 text-sm text-white shadow-lg">Drop images, sounds or video to add them to your library</p>
        </div>
      )}
      <Glass shape="capsule" thickness="thick" className="sticky top-4 z-20 flex items-center gap-2 px-3 py-2.5 sm:gap-3 sm:px-4">
        <Button aria-label="Back to projects" variant="ghost" size="icon" nativeButton={false} render={<Link href="/" />}>
          <ArrowLeft className="size-4" />
        </Button>
        <h1 className="flex-1 text-sm font-medium">Library</h1>
        <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/settings" />}>
          <Settings className="size-4" />
          Settings
        </Button>
        <Button size="sm" disabled={pending} onClick={() => fileInput.current?.click()}>
          {pending ? <Loader2 className="size-4 motion-safe:animate-spin" /> : <Upload className="size-4" />}
          Upload
        </Button>
      </Glass>

      <input
        ref={fileInput}
        type="file"
        multiple
        accept="image/*,audio/*,video/*"
        className="hidden"
        onChange={(e) => upload(e.target.files)}
      />

      <Tabs value={kind} onValueChange={(v) => setKind(v as "image" | "audio" | "video")}>
        <TabsList>
          <TabsTrigger value="image">Images</TabsTrigger>
          <TabsTrigger value="audio">Sounds</TabsTrigger>
          <TabsTrigger value="video">Video</TabsTrigger>
        </TabsList>

        <TabsContent value="image" className="pt-5">
          {assets.length ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {assets.map((a) => (
                <Card key={a.id} className="gap-0 overflow-hidden py-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={assetFileUrl(a.id)} alt="" className="aspect-square w-full object-cover" />
                  <CardContent className="flex items-center gap-2 px-3 py-2">
                    <span className="min-w-0 flex-1 truncate text-xs" title={a.name}>
                      {a.name}
                    </span>
                    <DeleteAsset asset={a} onRemove={remove} />
                  </CardContent>
                  {a.license ? (
                    <span className="px-3 pb-2 text-[10px] text-muted-foreground">{a.license}</span>
                  ) : null}
                </Card>
              ))}
            </div>
          ) : (
            <Empty kind="images" pending={pending} />
          )}
        </TabsContent>

        <TabsContent value="audio" className="pt-5">
          {assets.length ? (
            <div className="flex flex-col gap-2">
              {assets.map((a) => (
                <Card key={a.id} className="flex flex-row flex-wrap items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm font-medium">{a.name}</p>
                    {a.duration_sec ? (
                      <p className="font-mono text-xs text-muted-foreground">
                        {a.duration_sec.toFixed(1)}s
                      </p>
                    ) : null}
                  </div>
                  <audio controls preload="none" src={assetFileUrl(a.id)} aria-label={`Preview ${a.name}`} className="order-last h-9 w-full sm:order-none sm:max-w-[240px]" />
                  <DeleteAsset asset={a} onRemove={remove} />
                </Card>
              ))}
            </div>
          ) : (
            <Empty kind="sounds" pending={pending} />
          )}
        </TabsContent>
        <TabsContent value="video" className="pt-5">
          {assets.length ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {assets.map((a) => (
                <Card key={a.id} className="flex flex-col gap-2 p-3">
                  <video controls preload="metadata" src={assetFileUrl(a.id)} aria-label={`Preview ${a.name}`} className="aspect-video w-full rounded-lg bg-black object-contain" />
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{a.name}</p>
                      <p className="font-mono text-xs text-muted-foreground">{[a.width && a.height ? `${a.width}×${a.height}` : null, a.duration_sec ? `${a.duration_sec.toFixed(1)}s` : null].filter(Boolean).join(" · ")}</p>
                    </div>
                    <DeleteAsset asset={a} onRemove={remove} />
                  </div>
                </Card>
              ))}
            </div>
          ) : (
            <Empty kind="videos" pending={pending} />
          )}
        </TabsContent>
      </Tabs>

      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}

      <p className="mt-auto text-xs text-muted-foreground">
        Anything dropped into <code className="font-mono">workspace/library/</code> is picked up
        automatically. Rules, names, preferences and packs are in{" "}
        <Link href="/settings" className="underline underline-offset-2">settings</Link>.
      </p>
    </main>
  );
}

function Empty({ kind, pending }: { kind: string; pending: boolean }) {
  return (
    <Card>
      <CardContent className="py-10 text-center text-sm text-muted-foreground">
        {pending ? "Loading your library…" : `No ${kind} yet. Choose Upload to add your first file.`}
      </CardContent>
    </Card>
  );
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
          <DialogTitle>Delete this asset?</DialogTitle>
          <DialogDescription className="break-words">Remove “{asset.name}” from your library?</DialogDescription>
        </DialogHeader>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <DialogClose render={<Button variant="outline" disabled={pending} />}>Cancel</DialogClose>
          <Button variant="destructive" disabled={pending} onClick={remove}>
            {pending && <Loader2 aria-hidden className="motion-safe:animate-spin" />}
            {pending ? "Deleting…" : "Delete asset"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
