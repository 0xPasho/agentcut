"use client";
import { useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { Button } from "@/common/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/common/ui/dialog";

export function DeleteRule({ name, pending, onDelete }: { name: string; pending: boolean; onDelete: () => Promise<unknown> }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return <Dialog open={open} onOpenChange={value => { if (!busy) { setOpen(value); setError(""); } }}>
    <DialogTrigger render={<Button size="xs" variant="ghost" aria-label={`Delete ${name}`} />}><Trash2 aria-hidden /></DialogTrigger>
    <DialogContent><DialogHeader><DialogTitle>Delete this rule?</DialogTitle><DialogDescription>“{name}” will no longer apply. Videos it already changed keep those edits.</DialogDescription></DialogHeader>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <DialogFooter><DialogClose render={<Button variant="outline" disabled={busy} />}>Cancel</DialogClose><Button variant="destructive" disabled={pending || busy} onClick={async () => { setBusy(true); try { await onDelete(); setOpen(false); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }}>{busy && <Loader2 aria-hidden className="motion-safe:animate-spin" />}Delete rule</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
