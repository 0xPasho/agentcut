"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Glass } from "@/components/ui/glass";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, assetFileUrl, type AssetSummary } from "@/lib/client";

export function LibraryView() {
  const [kind, setKind] = useState<"image" | "audio">("image");
  const [assets, setAssets] = useState<AssetSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(
    (k: "image" | "audio") => {
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

  const upload = (files: FileList | null) => {
    if (!files?.length) return;
    setError(null);
    start(async () => {
      try {
        for (const file of Array.from(files)) await api.uploadAsset(file);
        setAssets((await api.listAssets(kind, "")).assets);
      } catch (e) {
        setError((e as Error).message);
      }
    });
  };

  const remove = (id: string) =>
    start(async () => {
      await api.deleteAsset(id);
      setAssets((prev) => prev.filter((a) => a.id !== id));
    });

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-6 px-6 pt-4 pb-14">
      <Glass shape="capsule" thickness="thick" className="sticky top-4 z-20 flex items-center gap-3 px-4 py-2.5">
        <Button variant="ghost" size="icon" render={<Link href="/" />}>
          <ArrowLeft className="size-4" />
        </Button>
        <h1 className="flex-1 text-sm font-medium">Library</h1>
        <Button size="sm" disabled={pending} onClick={() => fileInput.current?.click()}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
          Upload
        </Button>
      </Glass>

      <input
        ref={fileInput}
        type="file"
        multiple
        accept="image/*,audio/*"
        className="hidden"
        onChange={(e) => upload(e.target.files)}
      />

      <Tabs value={kind} onValueChange={(v) => setKind(v as "image" | "audio")}>
        <TabsList>
          <TabsTrigger value="image">Images</TabsTrigger>
          <TabsTrigger value="audio">Sounds</TabsTrigger>
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
                    <Button size="icon-xs" variant="ghost" onClick={() => remove(a.id)}>
                      <Trash2 className="size-3.5" />
                    </Button>
                  </CardContent>
                  {a.license ? (
                    <span className="px-3 pb-2 text-[10px] text-muted-foreground">{a.license}</span>
                  ) : null}
                </Card>
              ))}
            </div>
          ) : (
            <Empty kind="images" />
          )}
        </TabsContent>

        <TabsContent value="audio" className="pt-5">
          {assets.length ? (
            <div className="flex flex-col gap-2">
              {assets.map((a) => (
                <Card key={a.id} className="flex flex-row items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{a.name}</p>
                    {a.duration_sec ? (
                      <p className="font-mono text-xs text-muted-foreground">
                        {a.duration_sec.toFixed(1)}s
                      </p>
                    ) : null}
                  </div>
                  <audio controls preload="none" src={assetFileUrl(a.id)} className="h-8 max-w-[240px]" />
                  <Button size="icon-sm" variant="ghost" onClick={() => remove(a.id)}>
                    <Trash2 className="size-4" />
                  </Button>
                </Card>
              ))}
            </div>
          ) : (
            <Empty kind="sounds" />
          )}
        </TabsContent>
      </Tabs>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <p className="mt-auto text-xs text-muted-foreground">
        Anything dropped into <code className="font-mono">workspace/library/</code> is picked up
        automatically. Nothing is bundled — shipping sounds would mean shipping their licences.
      </p>
    </main>
  );
}

function Empty({ kind }: { kind: string }) {
  return (
    <Card>
      <CardContent className="py-10 text-center text-sm text-muted-foreground">
        No {kind} yet. Upload some, or drop files into{" "}
        <code className="font-mono">workspace/library/</code>.
      </CardContent>
    </Card>
  );
}
