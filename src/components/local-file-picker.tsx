"use client";

import { useEffect, useState } from "react";
import { ArrowUp, Film, Folder, House, ImageIcon, Loader2, Music } from "lucide-react";
import { api } from "@/lib/client";
import type { FolderEntry, FolderListing } from "@/lib/editor/local-assets";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";

const ICONS = { folder: Folder, video: Film, image: ImageIcon, audio: Music } as const;

/**
 * The folders of this machine, listed by the server that will read the file anyway. A local
 * app has no reason to copy a two-hour recording into its workspace before it can look at
 * it: the human picks the file here and the project keeps its path, which is exactly what
 * the agent sees through `assets.browseLocal`. The browser's own file dialog cannot do
 * this — it hands JavaScript the bytes and hides the path.
 */
export function LocalFilePicker({ open, onOpenChange, onPick, kinds = ["video"], title = "Choose a file on this computer", description }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (file: FolderEntry) => void;
  kinds?: ReadonlyArray<"video" | "image" | "audio">;
  title?: string;
  description?: string;
}) {
  const [folder, setFolder] = useState("");
  const [listing, setListing] = useState<FolderListing | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const browse = async (path?: string, offset = 0) => {
    setPending(true); setError("");
    try {
      const result = await api.browseFiles(path || undefined, offset);
      setListing(result); setFolder(result.path);
    } catch (e) { setError((e as Error).message); }
    finally { setPending(false); }
  };

  // The home folder is where a recording most often lands, and it is the same starting
  // point the agent gets when it browses without saying where.
  useEffect(() => { if (open && !listing) void browse(); }, [open]);

  type Kind = (typeof kinds)[number];
  const shown = listing?.entries.filter(entry => entry.kind === "folder" || kinds.includes(entry.kind as Kind)) ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(34rem,calc(100dvh-2rem))] flex-col gap-4 overflow-hidden sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description ?? "Nothing is copied. The project points at the file where it already lives."}</DialogDescription>
        </DialogHeader>
        <form className="flex gap-2" onSubmit={e => { e.preventDefault(); void browse(folder); }}>
          <Input aria-label="Folder path" value={folder} onChange={e => setFolder(e.target.value)} placeholder="~/Movies" />
          <Button type="submit" variant="outline" disabled={pending}>Open</Button>
        </form>
        <div className="flex items-center gap-2">
          <Button size="xs" variant="outline" disabled={pending} onClick={() => void browse()}><House aria-hidden />Home folder</Button>
          <Button size="xs" variant="ghost" disabled={pending || !listing?.parent} onClick={() => void browse(listing!.parent!)}><ArrowUp aria-hidden />Up</Button>
          {pending ? <Loader2 aria-hidden className="size-4 motion-safe:animate-spin text-muted-foreground" /> : null}
        </div>
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
          {shown.map(entry => {
            const Icon = ICONS[entry.kind];
            return (
              <li key={entry.path}>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => (entry.kind === "folder" ? void browse(entry.path) : onPick(entry))}
                  className="flex w-full min-w-0 items-center gap-2 rounded-lg px-2 py-2 text-left text-sm transition-colors duration-150 hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-ring motion-reduce:transition-none"
                >
                  <Icon aria-hidden className={`size-4 shrink-0 ${entry.kind === "folder" ? "text-muted-foreground" : "text-primary"}`} />
                  <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                </button>
              </li>
            );
          })}
          {!shown.length && !pending ? <li className="px-2 py-2 text-sm text-muted-foreground">Nothing here to choose. Try another folder.</li> : null}
        </ul>
        {listing && listing.total > listing.entries.length ? (
          <div className="flex items-center justify-between gap-2">
            <Button size="xs" variant="ghost" disabled={pending || listing.offset === 0} onClick={() => void browse(listing.path, Math.max(0, listing.offset - 100))}>Previous</Button>
            <span className="text-[11px] text-muted-foreground">{listing.total} entries</span>
            <Button size="xs" variant="ghost" disabled={pending || listing.nextOffset === null} onClick={() => void browse(listing.path, listing.nextOffset!)}>Next</Button>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
