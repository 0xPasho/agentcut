"use client";
import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/common/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/common/ui/dialog";
import { Textarea } from "@/common/ui/textarea";
import type { BuildIdeaRequest, HarnessOption } from "@agentcut/core/modules/ideas/types";
import { HarnessToggles } from "./harness-toggles";

/** Turn the picked saves into an idea: what to make of them, and who drafts it. */
export function BuildIdea({ open, count, harnesses, onClose, onBuild }: {
  open: boolean;
  count: number;
  harnesses: HarnessOption[];
  onClose: () => void;
  onBuild: (request: Omit<BuildIdeaRequest, "saveIds">) => Promise<void>;
}) {
  const [note, setNote] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!picked.length) setPicked(harnesses.filter((h) => h.ready).slice(0, 1).map((h) => h.id));
  }, [harnesses, picked.length]);

  const build = async () => {
    setBusy(true);
    await onBuild({ note: note.trim(), ...(picked.length ? { develop: { harnesses: picked } } : {}) });
    setBusy(false);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Build an idea from {count === 1 ? "1 save" : `${count} saves`}</DialogTitle>
          <DialogDescription>Each save brings its own note. Add what ties them together, if anything.</DialogDescription>
        </DialogHeader>
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={4} placeholder="e.g. One video for sardines, with the hook from the first and the pacing of the second" autoFocus />
        <div className="flex flex-col gap-2">
          <span className="text-xs text-muted-foreground">Draft the brief with</span>
          <HarnessToggles options={harnesses} value={picked} onChange={setPicked} />
          <span className="text-xs text-muted-foreground">
            {picked.length ? "Saved videos are watched and transcribed on this computer first." : "None picked: the idea waits in the inbox."}
          </span>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={busy} onClick={() => void build()}><Sparkles />{busy ? "Building…" : picked.length ? "Build and draft" : "Build idea"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
