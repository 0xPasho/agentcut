"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { CalendarDays, Check, Download, Plus, Send, Sparkles } from "lucide-react";
import { Button } from "../../../common/ui/button";
import { Input } from "../../../common/ui/input";
import { Destination as DestinationSchema } from "../types";
import type { Account, AgentCopyProposal, Destination, PublicationDetail, PhoneSession, ProviderId, PublishingOverview, PublishingRun, ValidationIssue } from "../types";
import { usePublishing } from "../hooks";
import { FORMATS } from "../data";
import { caption, resolveCopy } from "../lib/resolve";
import { localInstant } from "../lib/schedule";
import { PublicationStatusBadge } from "./status";
import { PhonePanel } from "./phone-panel";

export function PublicationPanel({ projectId, sequenceId, beforeRun, afterChange }: { projectId: string; sequenceId: string; beforeRun?: () => Promise<boolean>; afterChange?: () => void }) {
  const { data, error, busy, run } = usePublishing(projectId);
  const p = data?.publications.filter(p => p.sequenceId === sequenceId).at(-1);
  return <section className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-muted-foreground">Prepare once. Publish to every selected account.</p><Link href="/calendar" className="inline-flex items-center gap-2 text-sm underline underline-offset-4"><CalendarDays className="size-4" aria-hidden />Calendar</Link></div>
    <div role="alert" className="whitespace-pre-wrap text-sm text-destructive">{error}</div>
    {!data && <p role="status">Loading publication…</p>}
    {data && !p && <Button disabled={busy} onClick={async () => { if (beforeRun && !await beforeRun()) return; await run({ tool: "publication.prepare", projectId, sequenceIds: [sequenceId] }); }}><Plus />Prepare publication</Button>}
    {data && p && <PublicationForm key={p.id} publication={p} data={data} run={run} busy={busy} beforeRun={beforeRun} afterChange={afterChange} />}
  </section>;
}

export function PublicationForm({ publication: p, data, run, busy, beforeRun, afterChange, onDirtyChange, onPublicationChange, batchReview = false }: { publication: PublicationDetail; data: PublishingOverview; run: PublishingRun; busy: boolean; beforeRun?: () => Promise<boolean>; afterChange?: () => void; onDirtyChange?: (dirty: boolean) => void; onPublicationChange?: (publication: PublicationDetail) => void; batchReview?: boolean }) {
  const [draft, setDraft] = useState(p), [dirty, setDirty] = useState(false), [proposal, setProposal] = useState<AgentCopyProposal | null>(null), [localTime, setLocalTime] = useState(""), [formError, setFormError] = useState(""), [confirm, setConfirm] = useState(false);
  useEffect(() => { if (!dirty) setDraft(p); }, [p, dirty]);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => { setConfirm(false); }, [p.revision, p.artifactId]);
  const locked = p.destinations.some(d => !["not_sent", "failed"].includes(d.state));
  const update = (next: PublicationDetail) => { setDraft(next); setDirty(true); setConfirm(false); };
  const updateDestination = (next: Destination) => update({ ...draft, destinations: draft.destinations.map(d => d.id === next.id ? next : d) });
  const save = async () => {
    setFormError("");
    let at = draft.scheduledAt;
    if (localTime) { try { const [day, time] = localTime.split("T"); at = localInstant(day, time, draft.timezone); } catch (e) { setFormError((e as Error).message); return; } }
    const result = await run<PublicationDetail>({ tool: "publication.patch", id: p.id, revision: draft.revision, patch: { copy: draft.copy, scheduledAt: at, timezone: draft.timezone, phoneSource: draft.phoneSource, priority: draft.priority, expiresAt: draft.expiresAt }, destinations: draft.destinations });
    if (result) { setDraft(result); setDirty(false); setLocalTime(""); }
    return result;
  };
  return <div className="space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><PublicationStatusBadge status={p.status} /><Link className="text-xs underline underline-offset-4" href="/settings/publishing">Publishing connections</Link></div>
    {dirty && p.revision !== draft.revision && <p role="alert" className="text-sm text-destructive">This publication changed elsewhere. Your draft is still here. Reload the saved version before applying it.<Button variant="outline" onClick={() => { setDraft(p); setDirty(false); }}>Reload saved version</Button></p>}
    {formError && <p role="status" className="whitespace-pre-wrap text-sm">{formError}</p>}
    <fieldset disabled={busy || locked} className="space-y-4 disabled:opacity-70">
      <legend className="mb-3 text-sm font-medium">Shared text</legend>
      <label className="block space-y-1 text-sm">YouTube title<Input value={draft.copy.title} onChange={e => update({ ...draft, copy: { ...draft.copy, title: e.target.value } })} /></label>
      <label className="block space-y-1 text-sm">Description<textarea rows={4} className="w-full rounded-lg border bg-background p-3" value={draft.copy.description} onChange={e => update({ ...draft, copy: { ...draft.copy, description: e.target.value } })} /></label>
      <label className="block space-y-1 text-sm">Hashtags<Input value={draft.copy.hashtags.join(" ")} onChange={e => update({ ...draft, copy: { ...draft.copy, hashtags: e.target.value.split(/\s+/).map(t => t.replace(/^#/, "")).filter(Boolean) } })} /></label>
      <Button variant="outline" disabled={dirty} onClick={async () => { const result = await run<AgentCopyProposal>({ tool: "publication.copy.propose", id: p.id }); if (result) setProposal(result); }}><Sparkles />Propose text</Button>
      {proposal && <div className="space-y-3 rounded-lg border p-3"><p className="text-sm font-medium">{proposal.copy.title}</p><p className="whitespace-pre-wrap text-sm">{caption(proposal.copy)}</p><p className="text-xs text-muted-foreground">{proposal.reason}</p><div className="flex flex-wrap gap-2">{(["title", "description", "hashtags"] as const).map(field => <Button key={field} variant="outline" disabled={dirty} onClick={async () => { const result = await run({ tool: "publication.copy.apply", id: p.id, revision: proposal.revision, copy: { ...p.copy, [field]: proposal.copy[field] } }); if (result) setProposal(null); }}>Use {field}</Button>)}<Button variant="outline" disabled={dirty} onClick={async () => { const result = await run({ tool: "publication.copy.apply", id: p.id, revision: proposal.revision, copy: proposal.copy }); if (result) setProposal(null); }}>Use all proposed text</Button></div></div>}
      <div className="space-y-2"><p className="text-sm font-medium">Accounts</p>{!data.accounts.length && <p className="text-sm text-muted-foreground">Connect an account in Publishing settings to choose a destination.</p>}
        {data.accounts.map(a => <label key={a.id} className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" checked={draft.destinations.some(d => d.accountId === a.id)} onChange={e => { const format = Object.entries(FORMATS).find(([id, f]) => f.network === a.network && id !== "youtube-video")![0]; update({ ...draft, destinations: e.target.checked ? [...draft.destinations, DestinationSchema.parse({ id: crypto.randomUUID(), accountId: a.id, format })] : draft.destinations.filter(d => d.accountId !== a.id) }); }} />{a.name} · {a.network} · {data.connections.find(c => c.id === a.connectionId)?.name}{a.needsReconnect && " · reconnect needed"}</label>)}
      </div>
    </fieldset>
      {draft.destinations.map(d => <fieldset key={d.id} disabled={busy || !["not_sent", "failed"].includes(d.state)}><DestinationFields key={d.id} destination={d} account={data.accounts.find(a => a.id === d.accountId)} provider={data.connections.find(c => c.id === data.accounts.find(a => a.id === d.accountId)?.connectionId)?.provider} publication={draft} onChange={updateDestination} /></fieldset>)}
    <fieldset disabled={busy || locked} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2"><label className="space-y-1 text-sm">Timezone<Input value={draft.timezone} onChange={e => update({ ...draft, timezone: e.target.value })} /></label><label className="space-y-1 text-sm">Local publication time<Input type="datetime-local" value={localTime} onChange={e => { setLocalTime(e.target.value); setDirty(true); }} /></label></div>
      <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">Priority<Input type="number" value={draft.priority} onChange={e => update({ ...draft, priority: Number(e.target.value) })} /></label><label className="text-sm">Expires at (ISO with offset)<Input value={draft.expiresAt ?? ""} onChange={e => update({ ...draft, expiresAt: e.target.value || null })} /></label></div>
      <p className="text-xs text-muted-foreground">{draft.scheduledAt ? `Reserved: ${new Date(draft.scheduledAt).toLocaleString(undefined, { timeZone: draft.timezone })} (${draft.timezone})` : "No time reserved. Publish sends immediately."}</p>
      <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => { update({ ...draft, scheduledAt: null }); setLocalTime(""); }}>Clear local reservation</Button><Button variant="outline" disabled={dirty} onClick={() => void run({ tool: "publication.slots", ids: [p.id], from: new Date().toISOString().slice(0, 10), days: 30, reserve: true, revisions: { [p.id]: p.revision } })}>Reserve next free slot</Button></div>
    </fieldset>
    <div className="flex flex-wrap gap-2">
      <Button disabled={busy || !dirty} onClick={() => void save()}>Save publication</Button>
      {batchReview && dirty && <Button variant="ghost" disabled={busy} onClick={() => { setDraft(p); setDirty(false); setLocalTime(""); setFormError(""); }}>Discard changes</Button>}
    </div>
    <section className="space-y-3"><h3 className="text-sm font-medium">Approved video</h3>
      {!p.videoApproved && <Button variant="outline" disabled={busy || p.projectRevision === null} onClick={async () => { if (beforeRun && !await beforeRun()) return; const latest = await run<PublicationDetail>({ tool: "publication.read", id: p.id }); if (latest?.projectRevision !== null && latest?.projectRevision !== undefined) await run({ tool: "publication.approveVideo", id: p.id, projectRevision: latest.projectRevision }); afterChange?.(); }}><Check />Approve video</Button>}
      {p.artifact && <><video controls preload="metadata" className="max-h-80 w-full rounded-lg bg-black" src={`/api/publishing/artifact/${p.artifact.id}`} /><p className="text-xs text-muted-foreground">Pinned export · {p.artifact.width} × {p.artifact.height} · {Math.round(p.artifact.duration)} seconds</p><a className="text-sm underline underline-offset-4" href={`/api/publishing/artifact/${p.artifact.id}`} download={`${p.artifact.id}.mp4`}>Download this pinned export</a></>}
      {p.newerEdit && <p className="text-sm">A newer edit exists. This publication keeps the pinned export until you replace it.</p>}
      <Button variant="outline" disabled={busy || dirty || locked} onClick={async () => { if (beforeRun && !await beforeRun()) return; await run({ tool: "publication.pin", id: p.id, revision: p.revision, render: true }); }}><Download />{p.artifact ? "Render and replace export" : "Render and pin export"}</Button>
    </section>
    {p.destinations.some(d => data.connections.find(c => c.id === data.accounts.find(a => a.id === d.accountId)?.connectionId)?.provider === "iphone") && <fieldset disabled={busy || locked} className="space-y-3"><legend className="mb-2 text-sm font-medium">Video on the iPhone</legend><label className="block space-y-1 text-sm">Location<select className="min-h-10 w-full rounded-lg border bg-background px-3" value={draft.phoneSource?.kind ?? "drive"} onChange={e => update({ ...draft, phoneSource: { kind: e.target.value as "drive" | "photos", folder: draft.phoneSource?.folder ?? "", file: draft.phoneSource?.file ?? "", artifactId: p.artifactId } })}><option value="drive">Google Drive → Photos</option><option value="photos">Already in Photos</option></select></label><label className="block space-y-1 text-sm">Drive folder<Input value={draft.phoneSource?.folder ?? ""} onChange={e => update({ ...draft, phoneSource: { kind: draft.phoneSource?.kind ?? "drive", file: draft.phoneSource?.file ?? "", folder: e.target.value, artifactId: p.artifactId } })} /></label><label className="block space-y-1 text-sm">Exact video filename<Input value={draft.phoneSource?.file ?? ""} onChange={e => update({ ...draft, phoneSource: { kind: draft.phoneSource?.kind ?? "drive", folder: draft.phoneSource?.folder ?? "", file: e.target.value, artifactId: p.artifactId } })} /></label><p className="text-xs text-muted-foreground">Identify the copy of the pinned export. The phone session will verify it before uploading.</p><Button variant="outline" disabled={!dirty} onClick={() => void save()}>Save phone source</Button></fieldset>}
    <section className="space-y-3"><h3 className="text-sm font-medium">{batchReview ? "Delivery status" : "Send publication"}</h3>
      <Button variant="outline" disabled={busy || dirty} onClick={async () => { const issues = await run<ValidationIssue[]>({ tool: "publication.validate", id: p.id }); if (issues) setFormError(issues.length ? issues.map(issue => issue.message).join("\n") : "Ready for review and delivery."); }}>Check publication readiness</Button>
      {!batchReview && <><label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirm} onChange={e => setConfirm(e.target.checked)} />I reviewed this export, the text, selected accounts and times.</label>
      <Button disabled={busy || dirty || !confirm || !p.destinations.some(d => ["not_sent", "failed"].includes(d.state))} onClick={() => void run({ tool: "publication.dispatch", id: p.id, revision: p.revision, confirmed: true })}><Send />{p.scheduledAt ? "Schedule publication" : "Publish now"}</Button>
      <Button variant="outline" disabled={busy || dirty || !confirm} onClick={async () => { const result = await run({ tool: "publication.authorize", id: p.id, revision: p.revision }); if (result) setFormError("This exact publication is approved for the agent to send. Any edit requires a new approval."); }}>Approve for agent delivery</Button></>}
      <p className="text-xs text-muted-foreground">API destinations run locally until the provider accepts them. Start the attended session below for phone destinations.</p>
      <Button variant="outline" disabled={busy} onClick={() => void run({ tool: "publication.refresh", id: p.id })}>Refresh network status</Button>
      {p.destinations.map(d => <DestinationResult key={d.id} destination={d} publication={p} account={data.accounts.find(a => a.id === d.accountId)} session={data.sessions.find(s => s.status === "active" && s.publicationId === p.id && s.destinationIds.includes(d.id))} run={run} busy={busy} />)}
    </section>
    <PhonePanel publication={p} data={data} run={run} busy={busy} />
    {locked && <Button variant="outline" disabled={busy || dirty} onClick={async () => {
      const prepared = await run<PublicationDetail[]>({ tool: "publication.prepare", projectId: p.projectId, sequenceIds: [p.sequenceId], repeat: true });
      if (prepared?.[0]) onPublicationChange?.(prepared[0]);
    }}>Prepare a new release</Button>}
  </div>;
}

function DestinationFields({ destination: d, account, provider, publication, onChange }: { destination: Destination; account?: Account; provider?: ProviderId; publication: PublicationDetail; onChange: (d: Destination) => void }) {
  const copy = resolveCopy(publication.copy, d);
  return <details className="rounded-lg border p-3"><summary className="cursor-pointer text-sm font-medium">{account?.name ?? "Account"} · Customize for {account?.network}</summary><div className="mt-4 space-y-3">
    <label className="block space-y-1 text-sm">Format<select className="min-h-10 w-full rounded-lg border bg-background px-3" value={d.format} onChange={e => onChange({ ...d, format: e.target.value as Destination["format"] })}>{Object.entries(FORMATS).filter(([, f]) => f.network === account?.network).map(([id, f]) => <option key={id} value={id}>{f.label}</option>)}</select></label>
    {account?.network === "youtube" && <label className="block space-y-1 text-sm">Title<Input value={copy.title} onChange={e => onChange({ ...d, overrides: { ...d.overrides, title: e.target.value } })} /></label>}
    <label className="block space-y-1 text-sm">Description<textarea className="w-full rounded-lg border bg-background p-3" rows={3} value={copy.description} onChange={e => onChange({ ...d, overrides: { ...d.overrides, description: e.target.value } })} /></label>
    <label className="block space-y-1 text-sm">Hashtags<Input value={copy.hashtags.join(" ")} onChange={e => onChange({ ...d, overrides: { ...d.overrides, hashtags: e.target.value.split(/\s+/).map(t => t.replace(/^#/, "")).filter(Boolean) } })} /></label>
    <Button variant="outline" size="sm" onClick={() => onChange({ ...d, overrides: { title: null, description: null, hashtags: null } })}>Reset to shared text</Button>
    <label className="block space-y-1 text-sm">Own schedule (ISO time with offset, optional)<Input placeholder="2026-10-01T18:00:00-06:00" value={d.scheduledAt ?? ""} onChange={e => onChange({ ...d, scheduledAt: e.target.value || null })} /></label>
    {provider === "postbridge" && account?.network === "youtube" && <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={d.options.useProviderDefaults} onChange={e => onChange({ ...d, options: { ...d.options, useProviderDefaults: e.target.checked, madeForKids: null, privacy: "public" } })} />Use the audience and visibility configured in Postbridge. This API cannot change them.</label>}
    {account?.network === "youtube" && !d.options.useProviderDefaults && <label className="block space-y-1 text-sm">Made for kids<select className="min-h-10 w-full rounded-lg border bg-background px-3" value={d.options.madeForKids === null ? "" : String(d.options.madeForKids)} onChange={e => onChange({ ...d, options: { ...d.options, madeForKids: e.target.value === "" ? null : e.target.value === "true" } })}><option value="">Choose audience</option><option value="false">No</option><option value="true">Yes</option></select></label>}
    {account?.network === "youtube" && <label className="block space-y-1 text-sm">YouTube tags (comma separated)<Input value={d.options.tags.join(", ")} onChange={e => onChange({ ...d, options: { ...d.options, tags: e.target.value.split(",").map(v => v.trim()).filter(Boolean) } })} /></label>}
    {!d.options.useProviderDefaults && <label className="block space-y-1 text-sm">Visibility<select className="min-h-10 w-full rounded-lg border bg-background px-3" value={d.options.privacy} onChange={e => onChange({ ...d, options: { ...d.options, privacy: e.target.value as Destination["options"]["privacy"] } })}><option value="public">Public</option><option value="private">Private</option>{account?.network === "youtube" && <option value="unlisted">Unlisted</option>}</select></label>}
    <label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" checked={d.options.synthetic} onChange={e => onChange({ ...d, options: { ...d.options, synthetic: e.target.checked } })} />Disclose synthetic media</label>
    {account?.network === "tiktok" && <>{(["branded", "ownBrand", "comments", "duet", "stitch"] as const).map(key => <label key={key} className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" checked={d.options[key]} onChange={e => onChange({ ...d, options: { ...d.options, [key]: e.target.checked } })} />{{ branded: "Paid partnership", ownBrand: "Promotes my brand", comments: "Allow comments", duet: "Allow duet", stitch: "Allow stitch" }[key]}</label>)}</>}
    <p className="whitespace-pre-wrap rounded-lg bg-muted p-3 text-xs">{caption(copy)}</p>
  </div></details>;
}

function DestinationResult({ destination: d, publication: p, account, session, run, busy }: { destination: Destination; publication: PublicationDetail; account?: Account; session?: PhoneSession; run: PublishingRun; busy: boolean }) {
  const [note, setNote] = useState(""), [at, setAt] = useState(""), [url, setUrl] = useState(""), [outcome, setOutcome] = useState("published"), [moveAt, setMoveAt] = useState("");
  return <div className="space-y-2 rounded-lg border p-3"><p className="text-sm font-medium">{account?.name} · {d.state.replaceAll("_", " ")}</p>{d.confirmedAt && <p className="text-xs">Confirmed: {new Date(d.confirmedAt).toLocaleString()}</p>}{d.error && <p className="text-sm text-destructive">{d.error}</p>}{d.remoteUrl && <a href={d.remoteUrl} target="_blank" rel="noreferrer" className="text-sm underline">Open published post</a>}
    <div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" disabled={busy || ["published", "sending", "unknown", "cancelled"].includes(d.state)} onClick={() => void run({ tool: "publication.cancel", id: p.id, revision: p.revision, destinationId: d.id })}>Cancel destination</Button></div>
    {d.state === "scheduled" && <details><summary className="cursor-pointer text-xs">Move confirmed schedule</summary><div className="mt-3 space-y-2"><p className="text-xs">Current confirmed time: {d.confirmedAt}. This changes the provider schedule. For iPhone, cancel and verify the old schedule first.</p><label className="block text-sm">New time (ISO with offset)<Input value={moveAt} onChange={e => setMoveAt(e.target.value)} /></label><Button variant="outline" disabled={busy || !moveAt} onClick={() => void run({ tool: "publication.move", id: p.id, revision: p.revision, destinationId: d.id, at: moveAt })}>Confirm new remote time</Button></div></details>}
    {!["published", "cancelled"].includes(d.state) && <details><summary className="cursor-pointer text-xs">Record a result checked in the app</summary><div className="mt-3 space-y-2"><label className="block text-sm">Observed result<select className="min-h-10 w-full rounded-lg border bg-background px-3" value={outcome} onChange={e => setOutcome(e.target.value)}><option value="published">Published</option><option value="scheduled">Scheduled</option><option value="cancelled">Cancelled</option><option value="not_sent">Verified not sent</option></select></label><label className="block text-sm">Observed time (ISO with offset)<Input value={at} onChange={e => setAt(e.target.value)} /></label><label className="block text-sm">Post link<Input value={url} onChange={e => setUrl(e.target.value)} /></label><label className="block text-sm">What you verified<Input value={note} onChange={e => setNote(e.target.value)} /></label><Button variant="outline" disabled={busy} onClick={() => void run(session && outcome !== "not_sent" ? { tool: "publication.phone.record", sessionId: session.id, destinationId: d.id, outcome, at: at || null, remoteUrl: url || null, evidenceId: session.evidence.at(-1) ?? "", note } : { tool: "publication.reconcile", id: p.id, revision: p.revision, destinationId: d.id, state: outcome, at: at || null, remoteId: d.remoteId, remoteUrl: url || null, note })}>Record verified result</Button></div></details>}
  </div>;
}
