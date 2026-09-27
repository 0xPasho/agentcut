"use client";
import Link from "next/link";
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "../../../common/ui/dialog";
import { PublicationForm } from "./publication-panel";
import { dayInZone } from "../lib/resolve";
import { CalendarDays, Send } from "lucide-react";
import { Button } from "../../../common/ui/button";
import { usePublishing } from "../hooks";
import type { PublicationDetail } from "../types";
import { PublicationStatusBadge } from "./status";

export function ProjectPublications({ projectId, sequenceIds, beforeRun }: { projectId: string; sequenceIds: string[]; beforeRun: () => Promise<boolean> }) {
  const { data, error, busy, run } = usePublishing(projectId);
  const [review, setReview] = useState(false), [index, setIndex] = useState(0), [checked, setChecked] = useState<Record<string, number>>({}), [results, setResults] = useState<Array<{ id: string; ok: boolean; error?: string }>>([]);
  const selected = sequenceIds.flatMap(id => { const latest = data?.publications.filter(p => p.sequenceId === id).at(-1); return latest ? [latest] : []; });
  const current = selected[Math.min(index, selected.length - 1)];
  const reviewed = !!selected.length && selected.every(p => checked[p.id] === p.revision);
  const batch = async (action: "authorize" | "dispatch") => { const result = await run<Array<{ id: string; ok: boolean; error?: string }>>({ tool: "publication.batch", action, items: selected.map(p => ({ id: p.id, revision: p.revision })), confirmed: true }); if (result) setResults(result); };
  return <section className="space-y-3 rounded-xl border p-3"><div className="flex flex-wrap items-center gap-2"><Button variant="outline" disabled={busy || !sequenceIds.length} onClick={async () => { if (!await beforeRun()) return; await run<PublicationDetail[]>({ tool: "publication.prepare", projectId, sequenceIds }); }}><Send />Prepare {sequenceIds.length} selected publications</Button><Button variant="outline" disabled={busy || !selected.length} onClick={() => void run({ tool: "publication.slots", ids: selected.map(p => p.id), from: dayInZone(new Date().toISOString(), data?.settings.timezone ?? "UTC"), days: 30, reserve: true, revisions: Object.fromEntries(selected.map(p => [p.id, p.revision])) })}>Reserve slots</Button><Button variant="outline" disabled={busy || !selected.length} onClick={() => { setIndex(0); setReview(true); }}>Review batch</Button><Link href="/calendar" className="inline-flex items-center gap-2 text-sm underline underline-offset-4"><CalendarDays aria-hidden className="size-4" />Calendar</Link></div><div role="alert" className="text-sm text-destructive">{error}</div>{!!data?.publications.length && <ul className="space-y-2">{data.publications.map(p => <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 text-sm"><Link href={`/p/${projectId}/edit?sequence=${p.sequenceId}`} className="underline underline-offset-4">{p.label}</Link><PublicationStatusBadge status={p.status} /></li>)}</ul>}
    <Dialog open={review} onOpenChange={setReview}><DialogContent className="max-h-[85dvh] w-[min(42rem,94vw)] sm:max-w-[42rem] overflow-y-auto"><DialogHeader><DialogTitle>Review selected publications</DialogTitle><DialogDescription>Review each pinned video, account, resolved text and time. Sending can succeed on some networks and fail on others.</DialogDescription></DialogHeader>
      {current && data && <><div className="flex items-center justify-between gap-2"><Button variant="outline" disabled={index <= 0} onClick={() => setIndex(index - 1)}>Previous</Button><span className="text-sm">{index + 1} / {selected.length}</span><Button variant="outline" disabled={index >= selected.length - 1} onClick={() => setIndex(index + 1)}>Next</Button></div><h3 className="font-medium">{current.label}</h3><PublicationForm key={current.id} publication={current} data={data} run={run} busy={busy} beforeRun={beforeRun} /><label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" checked={checked[current.id] === current.revision} onChange={e => setChecked({ ...checked, [current.id]: e.target.checked ? current.revision : -1 })} />I reviewed this publication for batch delivery</label></>}
      <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy || !reviewed} onClick={() => void batch("authorize")}>Approve reviewed batch for agent</Button><Button disabled={busy || !reviewed} onClick={() => void batch("dispatch")}>Send reviewed batch</Button></div><ul aria-live="polite" className="text-sm">{results.map(result => <li key={result.id}>{selected.find(p => p.id === result.id)?.label}: {result.ok ? "Accepted" : result.error}</li>)}</ul>
    </DialogContent></Dialog>
  </section>;
}
