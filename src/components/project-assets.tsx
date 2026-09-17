"use client";
import { useEffect, useState } from "react";
import { api, type AssetSummary } from "@/lib/client";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
export function ProjectAssets({ projectId, onChoose }: { projectId: string; onChoose: (asset: AssetSummary) => void }) {
  const [images, setImages] = useState<AssetSummary[]>([]);
  const [selected, setSelected] = useState("");
  const [file, setFile] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const refresh = () => api.editorTool<AssetSummary[]>(projectId, { tool: "assets.list", kind: "image" }).then(setImages);
  useEffect(() => { void refresh().catch(e => setError(e.message)); }, [projectId]);
  return <div className="space-y-3">
    <label className="flex flex-col gap-1 text-xs">Image from library
      <select className="h-9 w-full rounded-xl border border-border bg-background px-2 text-sm focus-visible:outline-2 focus-visible:outline-ring" value={selected} onChange={e => setSelected(e.target.value)}>
        <option value="">Choose an image</option>{images.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>
    </label>
    <Button variant="outline" size="sm" disabled={!selected} onClick={() => { const asset = images.find(a => a.id === selected); if (asset) onChoose(asset); }}>Add library image</Button>
    <label className="flex flex-col gap-1 text-xs">Upload image or sound
      <Input type="file" accept="image/*,audio/*" disabled={pending} onChange={async e => {
        const chosen = e.target.files?.[0]; if (!chosen) return;
        setPending(true); setError("");
        try { const { asset } = await api.uploadAsset(chosen); await refresh(); if (asset.kind === "image") onChoose(asset); }
        catch(e) { setError((e as Error).message); } finally { setPending(false); }
      }} />
    </label>
    <details><summary className="cursor-pointer text-xs text-muted-foreground">Import a project file</summary>
      <label className="mt-2 flex flex-col gap-1 text-xs">Path inside this project’s workspace<Input value={file} onChange={e => setFile(e.target.value)} placeholder="assets/photo.jpg" /></label>
      <Button className="mt-2" size="sm" variant="outline" disabled={pending || !file.trim()} onClick={async () => {
        setPending(true); setError("");
        try { const asset = await api.editorTool<AssetSummary>(projectId, { tool: "assets.import", file }); await refresh(); if (asset.kind === "image") onChoose(asset); }
        catch(e) { setError((e as Error).message); } finally { setPending(false); }
      }}>Import asset</Button>
    </details>
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
  </div>;
}
