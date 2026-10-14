"use client";
import { useCallback, useEffect, useId, useState } from "react";
import { ImagePlus, Loader2, Trash2 } from "lucide-react";
import { api } from "@agentcut/core/common/api/client";
import { PACK_IMAGE_MAX_BYTES, PACK_SCREENSHOTS_MAX } from "@agentcut/core/modules/packs/data";
import type { PackImages } from "@agentcut/core/modules/packs/types";
import { Button } from "@/common/ui/button";
import { Input } from "@/common/ui/input";
import { Label } from "@/common/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/common/ui/select";

/** A subtle white edge on every picture, so a dark frame does not melt into the panel. */
const picture = "rounded-2xl bg-foreground/5 object-cover outline outline-1 -outline-offset-1 outline-white/10";

/**
 * A pack's cover and screenshots: what people see when choosing it in the marketplace and
 * before installing. Every button runs the same function as the agent's `packs.images.*`
 * tools, and an export carries what is here.
 */
export function ImagesEditor({ packId }: { packId: string }) {
  const id = useId();
  const [images, setImages] = useState<PackImages | null>(null);
  const [file, setFile] = useState("");
  const [as, setAs] = useState<"cover" | "screenshot">("cover");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const loaded = await api.workspace<PackImages>({ action: "packs.images.get", id: packId });
      setImages(loaded);
      if (loaded.cover) setAs("screenshot");
    } catch (reason) { setError((reason as Error).message); }
  }, [packId]);
  useEffect(() => { void load(); }, [load]);

  const run = async (label: string, body: Record<string, unknown>) => {
    setBusy(label);
    setError("");
    try {
      setImages(await api.workspace<PackImages>({ id: packId, ...body }));
      return true;
    } catch (reason) {
      setError((reason as Error).message);
      return false;
    } finally { setBusy(""); }
  };

  if (!images && !error) return <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-3 motion-safe:animate-spin" />Reading the pictures…</p>;

  const url = (path: string) => `/api/packs/${packId}/file?path=${encodeURIComponent(path)}`;
  const full = (images?.screenshots.length ?? 0) >= PACK_SCREENSHOTS_MAX;

  return (
    <div className="space-y-4 text-sm">
      {error && <p role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive">{error}</p>}
      {images?.cover ? (
        <figure className="relative">
          <img src={url(images.cover)} alt={`Cover of ${images.name}`} className={`${picture} aspect-video w-full max-w-xl`} />
          <RemoveButton label="Remove the cover" busy={busy === `remove:${images.cover}`} disabled={!!busy} onClick={() => void run(`remove:${images.cover}`, { action: "packs.images.remove", file: images.cover })} />
        </figure>
      ) : (
        <p className="text-xs text-muted-foreground">No cover yet. Without one, the marketplace card is text only.</p>
      )}
      {!!images?.screenshots.length && (
        <ul className="flex flex-wrap gap-3">
          {images.screenshots.map((shot, i) => (
            <li key={shot} className="relative">
              <img src={url(shot)} alt={`Screenshot ${i + 1} of ${images.name}`} className={`${picture} h-40 w-auto`} />
              <RemoveButton label={`Remove screenshot ${i + 1}`} busy={busy === `remove:${shot}`} disabled={!!busy} onClick={() => void run(`remove:${shot}`, { action: "packs.images.remove", file: shot })} />
            </li>
          ))}
        </ul>
      )}
      <form className="grid gap-2 rounded-xl border border-white/8 p-3" onSubmit={(event) => {
        event.preventDefault();
        void run("add", { action: "packs.images.add", file, as }).then((ok) => { if (ok) setFile(""); });
      }}>
        <Label htmlFor={`${id}-file`}>Add a picture</Label>
        <p className="text-xs text-muted-foreground">
          A png, jpg, webp or gif up to {PACK_IMAGE_MAX_BYTES / 1024 / 1024} MB: a frame of a video this pack made works best. The cover shows at 16:9.
        </p>
        <div className="flex flex-wrap gap-2">
          <Input id={`${id}-file`} className="min-w-56 flex-1" placeholder="~/Pictures/cover.png" value={file} onChange={(event) => setFile(event.target.value)} />
          <Select value={as} onValueChange={(value) => setAs(value as "cover" | "screenshot")}>
            <SelectTrigger aria-label="Use it as" className="w-44"><SelectValue>{(v: unknown) => roleLabel(String(v), Boolean(images?.cover))}</SelectValue></SelectTrigger>
            <SelectContent>
              <SelectItem value="cover">{roleLabel("cover", Boolean(images?.cover))}</SelectItem>
              <SelectItem value="screenshot" disabled={full}>{roleLabel("screenshot", false)}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button size="sm" type="submit" variant="outline" className="justify-self-start" disabled={!!busy || !file.trim() || (as === "screenshot" && full)}>
          {busy === "add" ? <Loader2 className="motion-safe:animate-spin" /> : <ImagePlus />}Add picture
        </Button>
      </form>
    </div>
  );
}

/** What adding a picture will do with it, said the same way in the trigger and the list. */
function roleLabel(role: string, hasCover: boolean) {
  if (role === "cover") return hasCover ? "Replace the cover" : "As the cover";
  return "As a screenshot";
}

function RemoveButton({ label, busy, disabled, onClick }: { label: string; busy: boolean; disabled: boolean; onClick: () => void }) {
  return (
    <Button type="button" size="icon-xs" variant="secondary" aria-label={label} title={label} disabled={disabled} onClick={onClick} className="absolute end-2 top-2 shadow-sm">
      {busy ? <Loader2 className="motion-safe:animate-spin" /> : <Trash2 />}
    </Button>
  );
}
