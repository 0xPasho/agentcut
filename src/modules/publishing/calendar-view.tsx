"use client";
import Link from "next/link";
import { useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "../../common/ui/button";
import { Input } from "../../common/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "../../common/ui/dialog";
import { usePublishing } from "./hooks";
import type { CalendarMove, PublishingOverview } from "./types";
import { localInstant } from "./lib/schedule";
import { calendarDates, adjacentPeriod } from "./lib/calendar";
import { STATUS_LABELS } from "./data";
import { dayInZone, intendedTime } from "./lib/resolve";
import { PublicationStatusBadge } from "./components/status";
import { PublicationForm } from "./components/publication-panel";

export function CalendarView({ initial }: { initial: PublishingOverview }) {
  const [anchor, setAnchor] = useState(dayInZone(new Date().toISOString(), initial.settings.timezone)), [view, setView] = useState("week"), [account, setAccount] = useState(""), [status, setStatus] = useState(""), [selected, setSelected] = useState<string[]>([]), [open, setOpen] = useState<string | null>(null);
  const [offset, setOffset] = useState(0), [move, setMove] = useState<CalendarMove | null>(null), [moveError, setMoveError] = useState("");
  const dates = calendarDates(anchor, view);
  const { data = initial, error, busy, run } = usePublishing(undefined, initial, { from: dates[0], to: dates.at(-1)!, offset });
  const publications = data.publications.filter(p => (!account || p.destinations.some(d => d.accountId === account)) && (!status || p.status === status));
  const attention = data.publications.filter(p => p.status === "attention" || p.status === "partial");
  const phoneDue = publications.filter(p => p.destinations.some(d => {
    const connectionId = data.accounts.find(a => a.id === d.accountId)?.connectionId;
    const phone = data.connections.find(c => c.id === connectionId)?.provider === "iphone";
    const at = intendedTime(p, d);
    return phone && ["not_sent", "queued", "unknown", "sending"].includes(d.state) && (!at || Date.parse(at) - data.settings.leadMinutes * 60_000 <= Date.now());
  }));
  const unscheduled = publications.filter(p => !p.destinations.some(d => intendedTime(p, d) || d.confirmedAt));
  const current = data.publications.find(p => p.id === open);
  const revisions = Object.fromEntries(data.publications.map(p => [p.id, p.revision]));
  const navigate = (step: number) => { setOffset(0); setAnchor(adjacentPeriod(anchor, view, step)); };
  return <section className="space-y-6">
    <header className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="flex items-center gap-2 text-xl font-medium"><CalendarDays className="size-5" aria-hidden />Publication calendar</h2><p className="mt-1 text-sm text-muted-foreground">{data.settings.timezone} · Local reservations and confirmed network schedules</p></div><Link href="/settings/publishing" className="text-sm underline underline-offset-4">Publishing settings</Link></header>
    <div role="alert" className="whitespace-pre-wrap text-sm text-destructive">{error}</div>
    <div className="flex flex-wrap items-end gap-3"><Button variant="outline" aria-label="Previous period" onClick={() => navigate(-1)}><ChevronLeft /></Button><label className="text-sm">Starting date<Input type="date" value={anchor} onChange={e => e.target.value && setAnchor(e.target.value)} /></label><Button variant="outline" aria-label="Next period" onClick={() => navigate(1)}><ChevronRight /></Button><label className="text-sm">View<select className="block min-h-10 rounded-lg border bg-background px-3" value={view} onChange={e => setView(e.target.value)}><option value="week">Week</option><option value="month">Month</option><option value="agenda">Agenda</option></select></label><label className="text-sm">Account<select className="block min-h-10 max-w-full rounded-lg border bg-background px-3" value={account} onChange={e => setAccount(e.target.value)}><option value="">All accounts</option>{data.accounts.map(a => <option key={a.id} value={a.id}>{a.name} · {a.network}</option>)}</select></label><label className="text-sm">Status<select className="block min-h-10 rounded-lg border bg-background px-3" value={status} onChange={e => setStatus(e.target.value)}><option value="">All statuses</option>{Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
    {!!attention.length && <p role="status" className="text-sm">{attention.length} publications need attention.</p>}
    {!!phoneDue.length && <section className="space-y-2 rounded-xl border p-4"><h3 className="text-sm font-medium">iPhone preparation due</h3><p className="text-xs text-muted-foreground">Prepare these on this Mac before their publication times.</p>{phoneDue.map(p => <Button key={p.id} variant="outline" onClick={() => setOpen(p.id)}>{p.label}</Button>)}</section>}
    {selected.length > 0 && <div className="flex flex-wrap items-center gap-3 rounded-lg border p-3"><span className="text-sm">{selected.length} selected</span><Button variant="outline" disabled={busy} onClick={() => void run({ tool: "publication.slots", ids: selected, from: anchor, days: 30, reserve: true, revisions })}>Reserve next free slots</Button><Button variant="ghost" onClick={() => setSelected([])}>Clear selection</Button></div>}
    <div className={view === "agenda" ? "space-y-4" : "grid grid-cols-1 gap-3 lg:grid-cols-7"}>{dates.map(day => <section key={day} className="min-w-0 rounded-xl border p-3" onDragOver={e => e.preventDefault()} onDrop={e => {
      e.preventDefault();
      try {
        const [publicationId, destinationId] = e.dataTransfer.getData("text/plain").split("/");
        const p = data.publications.find(p => p.id === publicationId), d = p?.destinations.find(d => d.id === destinationId);
        if (!p || !d || !["not_sent", "failed", "scheduled"].includes(d.state)) return;
        const before = d.confirmedAt ?? intendedTime(p, d); if (!before) return;
        const time = new Intl.DateTimeFormat("en-GB", { timeZone: data.settings.timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(before));
        setMove({ publicationId, destinationId, before, after: localInstant(day, time, data.settings.timezone) }); setMoveError("");
      } catch (error) { setMoveError((error as Error).message); }
    }}><h3 className="mb-3 text-sm font-medium">{new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</h3><div className="space-y-3">{publications.filter(p => p.destinations.some(d => { const at = d.confirmedAt ?? intendedTime(p, d); return at && dayInZone(at, data.settings.timezone) === day; })).map(p => <div key={p.id} className="space-y-2 rounded-lg bg-muted p-2"><button className="w-full break-words text-left text-sm font-medium underline-offset-4 hover:underline focus-visible:outline-2" onClick={() => setOpen(p.id)}>{p.label}</button><PublicationStatusBadge status={p.status} /><div className="space-y-1">{p.destinations.filter(d => { const at = d.confirmedAt ?? intendedTime(p, d); return at && dayInZone(at, data.settings.timezone) === day; }).map(d => <p key={d.id} draggable={["not_sent", "failed", "scheduled"].includes(d.state)} onDragStart={e => e.dataTransfer.setData("text/plain", `${p.id}/${d.id}`)} className="text-xs text-muted-foreground">{data.accounts.find(a => a.id === d.accountId)?.network} · {new Date((d.confirmedAt ?? intendedTime(p, d))!).toLocaleTimeString(undefined, { timeZone: data.settings.timezone, hour: "2-digit", minute: "2-digit" })}{!d.confirmedAt && " · reserved locally"}</p>)}</div></div>)}</div></section>)}</div>
    <section className="space-y-3"><h3 className="text-base font-medium">Unscheduled videos</h3>{!unscheduled.length && <p className="text-sm text-muted-foreground">Prepare a publication from a video's editor to add it here.</p>}{unscheduled.map(p => <div key={p.id} className="flex items-center gap-3 rounded-lg border p-3"><input aria-label={`Select ${p.label}`} type="checkbox" checked={selected.includes(p.id)} onChange={e => setSelected(e.target.checked ? [...selected, p.id] : selected.filter(id => id !== p.id))} /><button className="min-w-0 flex-1 text-left text-sm hover:underline" onClick={() => setOpen(p.id)}>{p.label}</button><PublicationStatusBadge status={p.status} /><Link className="text-xs underline" href={`/p/${p.projectId}/edit?sequence=${p.sequenceId}`}>Editor</Link></div>)}</section>
    <div className="flex gap-2">{offset > 0 && <Button variant="outline" onClick={() => setOffset(Math.max(0, offset - 100))}>Previous publications</Button>}{data.nextOffset != null && <Button variant="outline" onClick={() => setOffset(data.nextOffset!)}>More publications in this period</Button>}</div>
    <p className="text-xs text-muted-foreground">Reservations also respect the last refreshed API provider calendar. Native app changes need manual verification.</p>
    {data.connections.filter(c => c.provider !== "iphone").map(c => { const snapshot = data.externalCalendars?.find(s => s.connectionId === c.id); return <p key={c.id} className="text-xs text-muted-foreground">{c.name}: {snapshot ? `external schedule checked ${new Date(snapshot.checkedAt).toLocaleString()}` : "external schedule has not been checked"} <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run({ tool: "publishing.calendar.sync", connectionId: c.id })}>Refresh</Button></p>; })}
    {moveError && <p role="alert" className="text-sm text-destructive">{moveError}</p>}
    <Dialog open={!!move} onOpenChange={open => { if (!open) setMove(null); }}><DialogContent><DialogHeader><DialogTitle>Confirm publication time</DialogTitle><DialogDescription>Review the time change before updating this destination. Confirmed API schedules are updated remotely; phone schedules must be cancelled and verified first.</DialogDescription></DialogHeader><p className="text-sm">From {move?.before}<br />To {move?.after}</p><Button disabled={busy} onClick={async () => {
      if (!move) return; const p = data.publications.find(p => p.id === move.publicationId), d = p?.destinations.find(d => d.id === move.destinationId); if (!p || !d) return;
      const result = await run(d.state === "scheduled" ? { tool: "publication.move", id: p.id, revision: p.revision, destinationId: d.id, at: move.after } : { tool: "publication.patch", id: p.id, revision: p.revision, patch: {}, destinations: p.destinations.map(dest => dest.id === d.id ? { ...dest, scheduledAt: move.after } : dest) }); if (result) setMove(null);
    }}>Confirm time change</Button></DialogContent></Dialog>
    <Dialog open={!!current} onOpenChange={value => { if (!value) setOpen(null); }}><DialogContent className="max-h-[85dvh] w-[min(42rem,94vw)] sm:max-w-[42rem] overflow-y-auto"><DialogHeader><DialogTitle>{current?.label ?? "Publication"}</DialogTitle><DialogDescription>Review the pinned video and each destination before sending.</DialogDescription></DialogHeader>{current && <PublicationForm key={current.id} publication={current} data={data} run={run} busy={busy} />}</DialogContent></Dialog>
  </section>;
}
