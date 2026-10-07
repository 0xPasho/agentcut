"use client";

import { useState } from "react";
import { CalendarDays, CheckCheck, ChevronLeft, ChevronRight, Loader2, Send } from "lucide-react";
import { Button } from "../../../common/ui/button";
import { Checkbox } from "../../../common/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "../../../common/ui/dialog";
import { count } from "@agentcut/core/common/lib/format";
import { PublicationForm } from "./publication-panel";
import { dayInZone } from "@agentcut/core/modules/publishing/lib/resolve";
import { usePublishing } from "../hooks";
import type { PublicationBatchResult, PublicationDetail, SlotPlan } from "@agentcut/core/modules/publishing/types";

export function ProjectPublications({ projectId, sequenceIds, beforeRun, disabled = false }: {
  projectId: string;
  sequenceIds: string[];
  beforeRun: () => Promise<boolean>;
  disabled?: boolean;
}) {
  const { data, error, busy, run } = usePublishing(projectId);
  const [open, setOpen] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [prepareError, setPrepareError] = useState("");
  const [publicationIds, setPublicationIds] = useState<string[]>([]);
  const [targets, setTargets] = useState<string[]>([]);
  const [index, setIndex] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [checked, setChecked] = useState<Record<string, number>>({});
  const [results, setResults] = useState<PublicationBatchResult[]>([]);
  const [slots, setSlots] = useState<SlotPlan | null>(null);
  // Freeze the prepared IDs for this review; background refreshes must not change its scope.
  const selected = publicationIds.flatMap(id => data?.publications.find(p => p.id === id) ?? []);
  const currentIndex = Math.min(index, selected.length - 1);
  const current = selected[currentIndex];
  const reviewedCount = selected.filter(p => checked[p.id] === p.revision).length;
  const reviewed = selected.length === targets.length && selected.length > 0 && reviewedCount === selected.length;
  const working = busy || preparing || disabled;

  const prepare = async (ids: string[]) => {
    setPreparing(true);
    setPrepareError("");
    setTargets([...ids]);
    setPublicationIds([]);
    setIndex(0);
    setDirty(false);
    setChecked({});
    setResults([]);
    setSlots(null);
    try {
      if (!await beforeRun()) {
        setPrepareError("Save your video changes before preparing publications. Close this panel to resolve any save errors.");
        return;
      }
      const prepared = await run<PublicationDetail[]>({ tool: "publication.prepare", projectId, sequenceIds: ids });
      if (prepared) setPublicationIds(prepared.map(p => p.id));
    } catch (cause) {
      setPrepareError(cause instanceof Error ? cause.message : "Unable to prepare publications. Try again.");
    } finally {
      setPreparing(false);
    }
  };

  const reserve = async () => {
    const result = await run<SlotPlan>({
      tool: "publication.slots",
      ids: selected.map(p => p.id),
      from: dayInZone(new Date().toISOString(), data?.settings.timezone ?? "UTC"),
      days: 30,
      reserve: true,
      revisions: Object.fromEntries(selected.map(p => [p.id, p.revision])),
    });
    if (result) setSlots(result);
  };

  const batch = async (action: "authorize" | "dispatch") => {
    if (working || dirty || !reviewed) return;
    const result = await run<PublicationBatchResult[]>({
      tool: "publication.batch", action,
      items: selected.map(p => ({ id: p.id, revision: p.revision })), confirmed: true,
    });
    if (result) setResults(result);
  };

  return (
    <Dialog open={open} onOpenChange={next => { if (!busy && !preparing && !dirty) setOpen(next); }}>
      <DialogTrigger render={
        <Button size="sm" variant="outline" className="min-h-9" disabled={working || !sequenceIds.length} onClick={() => void prepare([...sequenceIds])}>
          <Send aria-hidden className="size-4" />
          {sequenceIds.length === 1 ? "Prepare publication" : "Prepare publications"}
        </Button>
      } />
      <DialogContent showCloseButton={!busy && !preparing && !dirty} className="flex max-h-[90dvh] w-[min(70rem,96vw)] flex-col gap-0 overflow-hidden rounded-3xl p-0 sm:max-w-[70rem]">
        <DialogHeader className="shrink-0 px-5 pt-5 pb-4 pe-14">
          <DialogTitle>Prepare {count(targets.length, "publication", "publications")}</DialogTitle>
          <DialogDescription>Review each video, its text, accounts and time before sending.</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-5 pb-5">
          <div role="alert" className="whitespace-pre-wrap text-sm text-destructive">{prepareError || error}</div>
          {preparing && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 aria-hidden className="size-4 motion-safe:animate-spin" />Preparing publications…</p>}
          {!preparing && !selected.length && <Button variant="outline" disabled={working} onClick={() => void prepare(targets)}>Try preparing again</Button>}

          {current && data && <>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white/5 p-3">
              <div className="min-w-0 flex-1">
                <p className="text-xs text-muted-foreground">Timing for {count(selected.length, "publication", "publications")}</p>
                <p className="mt-1 text-xs text-muted-foreground">Reserve local slots, then review each time.</p>
              </div>
              <Button size="sm" variant="outline" className="min-h-9" disabled={working || dirty} onClick={() => void reserve()}>
                <CalendarDays aria-hidden className="size-4" />Reserve slots
              </Button>
            </div>
            {slots && <div role="status" className="space-y-2 text-sm">
              <p>{count(slots.placements.length, "slot", "slots")} reserved.</p>
              {slots.unavailable.map(item => <p key={item.publicationId} className="text-muted-foreground">{selected.find(p => p.id === item.publicationId)?.label}: {item.reason}</p>)}
            </div>}

            <nav aria-label="Selected publications" className="flex items-center justify-between gap-3">
              <Button size="icon" variant="ghost" aria-label="Previous publication" title="Previous publication" disabled={working || dirty || currentIndex <= 0} onClick={() => setIndex(currentIndex - 1)}><ChevronLeft aria-hidden className="size-4" /></Button>
              <p role="status" className="text-xs text-muted-foreground tabular-nums">Publication {currentIndex + 1} of {selected.length}</p>
              <Button size="icon" variant="ghost" aria-label="Next publication" title="Next publication" disabled={working || dirty || currentIndex >= selected.length - 1} onClick={() => setIndex(currentIndex + 1)}><ChevronRight aria-hidden className="size-4" /></Button>
            </nav>
            <h3 className="text-base font-medium text-balance">{current.label}</h3>
            <PublicationForm key={current.id} publication={current} data={data} run={run} busy={working} beforeRun={beforeRun} onDirtyChange={setDirty} batchReview
              onPublicationChange={publication => {
                setPublicationIds(ids => ids.map(id => id === current.id ? publication.id : id));
                setSlots(null);
                setResults([]);
              }}
            />
          </>}
        </div>

        {current && <div className="shrink-0 space-y-3 border-t border-white/10 bg-black/20 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Checkbox checked={checked[current.id] === current.revision} disabled={working || dirty} onCheckedChange={value => setChecked(previous => ({ ...previous, [current.id]: value ? current.revision : -1 }))}>
              <span className="text-xs">Reviewed this publication</span>
            </Checkbox>
            <span role="status" className="text-xs text-muted-foreground tabular-nums">{reviewedCount} of {selected.length} reviewed</span>
          </div>
          {dirty && <p role="status" className="text-xs text-muted-foreground">Save or discard your publication changes before continuing or closing this panel.</p>}
          <div className="flex flex-wrap justify-end gap-2">
            <Button size="sm" variant="outline" className="min-h-9" disabled={working || dirty || !reviewed} onClick={() => void batch("authorize")}><CheckCheck aria-hidden className="size-4" />Approve for agent</Button>
            <Button size="sm" className="min-h-9" disabled={working || dirty || !reviewed} onClick={() => void batch("dispatch")}><Send aria-hidden className="size-4" />Send {count(selected.length, "publication", "publications")}</Button>
          </div>
          {!!results.length && <ul aria-live="polite" className="max-h-24 space-y-1 overflow-y-auto text-xs">
            {results.map(result => <li key={result.id}>{selected.find(p => p.id === result.id)?.label}: {result.ok ? "Accepted" : result.error}</li>)}
          </ul>}
        </div>}
      </DialogContent>
    </Dialog>
  );
}
