"use client";
import { useEffect, useId, useState } from "react";
import { api, type AssetSummary } from "@/lib/client";
import { Button } from "./ui/button";
import { Disclosure } from "./ui/disclosure";
import { Input } from "./ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
export function ProjectAssets({ projectId, onChoose }: { projectId: string; onChoose: (asset: AssetSummary) => void }) {
  const id = useId();
  const [images, setImages] = useState<AssetSummary[]>([]);
  const [selected, setSelected] = useState("");
  const [file, setFile] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const refresh = () => api.editorTool<AssetSummary[]>(projectId, { tool: "assets.list", kind: "image" }).then(setImages);
  useEffect(() => { void refresh().catch(e => setError(e.message)); }, [projectId]);
  return <div className="space-y-3">
    <div className="flex flex-col gap-1 text-xs">
      <span id={`${id}-library`}>Image from library</span>
      <Select value={selected} onValueChange={value => setSelected(value ?? "")}>
        <SelectTrigger size="sm" className="w-full" aria-labelledby={`${id}-library`}><SelectValue placeholder="Choose an image" /></SelectTrigger>
        <SelectContent>{images.map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
      </Select>
    </div>
    <Button variant="outline" size="sm" disabled={!selected} onClick={() => { const asset = images.find(a => a.id === selected); if (asset) onChoose(asset); }}>Add library image</Button>
    <label className="flex flex-col gap-1 text-xs">Upload image or sound
      <Input type="file" accept="image/*,audio/*" disabled={pending} onChange={async e => {
        const chosen = e.target.files?.[0]; if (!chosen) return;
        setPending(true); setError("");
        try { const { asset } = await api.uploadAsset(chosen); await refresh(); if (asset.kind === "image") onChoose(asset); }
        catch(e) { setError((e as Error).message); } finally { setPending(false); }
      }} />
    </label>
    <Disclosure variant="plain" summary="Import a project file">
      <label className="flex flex-col gap-1 text-xs">Path inside this project’s workspace<Input value={file} onChange={e => setFile(e.target.value)} placeholder="assets/photo.jpg" /></label>
      <Button className="mt-2" size="sm" variant="outline" disabled={pending || !file.trim()} onClick={async () => {
        setPending(true); setError("");
        try { const asset = await api.editorTool<AssetSummary>(projectId, { tool: "assets.import", file }); await refresh(); if (asset.kind === "image") onChoose(asset); }
        catch(e) { setError((e as Error).message); } finally { setPending(false); }
      }}>Import asset</Button>
    </Disclosure>
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
  </div>;
}
