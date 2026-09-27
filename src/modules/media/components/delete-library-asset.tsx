"use client";
import { useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { Button } from "../../../common/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose, DialogTrigger } from "../../../common/ui/dialog";
import type { AssetSummary } from "../../../common/api/client";

export function DeleteLibraryAsset({ asset, onRemove }: { asset: AssetSummary; onRemove: (id: string) => Promise<void> }) {
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
