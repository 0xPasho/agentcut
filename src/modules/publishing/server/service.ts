import { createHash, randomUUID } from "node:crypto";
import { readEditor, editProject } from "../../editor/server/store";
import { projectVideos } from "../../project/lib/overview";
import { Publication, Destination, PublishingSettings } from "../types";
import type { CalendarPlacement, PublicationDetail, Copy, Occupancy, PublishingOverview } from "../types";
import { FORMATS } from "../data";
import { caption, intendedTime, publicationStatus, resolveCopy } from "../lib/resolve";
import { planSlots } from "../lib/schedule";
import { validatePublication } from "../lib/validate";
import { contentSignature, pinExport, verifyArtifact } from "./artifacts";
import * as store from "./store";
import { externalOccupancy } from "./providers/occupancy";

export function videoFacts(p: Publication) {
  try { const { edl } = readEditor(p.projectId); const video = projectVideos(edl).find(v => v.id === p.sequenceId); return { approved: video?.status === "approved" || video?.status === "rendered", signature: contentSignature(edl, p.sequenceId) }; }
  catch { return { approved: false, signature: null }; }
}
export function detail(p: Publication): PublicationDetail {
  const facts = videoFacts(p), artifact = p.artifactId ? store.artifact(p.artifactId) : null;
    return { ...p, status: publicationStatus(p, facts.approved), videoApproved: facts.approved, projectRevision: (() => { try { return readEditor(p.projectId).revision; } catch { return null; } })(), newerEdit: !!artifact && facts.signature !== artifact.signature, artifact };
}
export function overview(projectId?: string): PublishingOverview { return { publications: store.publications().filter(p => !p.archived && (!projectId || p.projectId === projectId)).map(detail), accounts: store.accounts(), connections: store.connections(), settings: store.settings(), sessions: store.sessions(), externalCalendars: store.documents("external-calendar").map(raw => { const snapshot = raw as { connectionId: string; checkedAt: number }; return { connectionId: snapshot.connectionId, checkedAt: snapshot.checkedAt }; }) }; }
export function prepare(projectId: string, sequenceId: string, accountIds?: string[], repeat = false) {
  const { edl } = readEditor(projectId), video = projectVideos(edl).find(v => v.id === sequenceId);
  if (!video) throw new Error("Video not found");
  return store.transaction(() => {
    const existing = store.publications().filter(p => p.projectId === projectId && p.sequenceId === sequenceId && !p.archived).at(-1);
    if (existing && !repeat) return detail(existing);
    const settings = store.settings(), now = Date.now();
    const p = Publication.parse({ id: randomUUID(), projectId, sequenceId, label: video.title, copy: { title: video.title, description: video.summary, hashtags: [] }, timezone: settings.timezone, scheduledAt: null, artifactId: null, revision: 0, createdAt: now, updatedAt: now, destinations: (accountIds ?? settings.defaultAccountIds).map(id => makeDestination(id)) });
    store.savePublication(p); return detail(p);
  });
}
export function makeDestination(accountId: string) {
  const a = store.account(accountId);
  const format = Object.entries(FORMATS).find(([id, f]) => f.network === a.network && id !== "youtube-video")![0];
  return Destination.parse({ id: randomUUID(), accountId, format });
}
export function assertEditable(p: Publication) { if (p.destinations.some(d => !["not_sent", "failed"].includes(d.state))) throw new Error("This publication has submitted or queued destinations. Cancel/reconcile them before changing its approved payload, or create a repeat publication."); }
function resetDestination(publicationId: string, input: Destination, existing?: Destination): Destination {
  if (existing?.payload) store.put("delivery-history", randomUUID(), { publicationId, destination: structuredClone(existing), at: Date.now() });
  return Destination.parse({ id: input.id, accountId: input.accountId, format: input.format, overrides: input.overrides, options: input.options, scheduledAt: input.scheduledAt });
}
export function reschedule(id: string, revision: number, placements: CalendarPlacement[]) {
  return detail(store.change(id, revision, p => {
    if (new Set(placements.map(item => item.destinationId)).size !== placements.length) throw new Error("Choose each destination only once");
    for (const { destinationId, at } of placements) {
      const d = p.destinations.find(d => d.id === destinationId);
      if (!d) throw new Error("Destination not found");
      if (!["not_sent", "failed"].includes(d.state)) throw new Error("This destination has already been submitted. Review its delivery before changing its time.");
      if (at && p.expiresAt && Date.parse(at) >= Date.parse(p.expiresAt)) throw new Error("Choose a time before this publication expires");
      Object.assign(d, resetDestination(p.id, { ...d, scheduledAt: at }, d));
    }
    checkReservations(p);
  }));
}
export function patch(id: string, revision: number, patch: Partial<Pick<Publication, "label" | "copy" | "scheduledAt" | "timezone" | "priority" | "expiresAt" | "phoneSource">>, destinations?: Destination[]) {
  return detail(store.change(id, revision, p => {
    const mutable = (d: Destination) => ["not_sent", "failed"].includes(d.state);
    const submitted = p.destinations.some(d => !mutable(d));
    if (submitted && Object.entries(patch).some(([key, value]) => JSON.stringify(p[key as keyof Publication]) !== JSON.stringify(value))) {
      throw new Error("Submitted destinations keep their shared content. Edit the failed destination's overrides or prepare a new release.");
    }
    Object.assign(p, patch);
    if (destinations) {
      if (new Set(destinations.map(d => d.accountId)).size !== destinations.length) throw new Error("Select each account only once");
      for (const existing of p.destinations) if (!mutable(existing) && !destinations.some(d => d.id === existing.id)) throw new Error("A submitted destination cannot be removed from history");
      p.destinations = destinations.map(input => {
        store.account(input.accountId);
        const existing = p.destinations.find(d => d.id === input.id);
        if (existing && existing.accountId !== input.accountId) throw new Error("Remove and add the destination to change its account");
        const fields = { format: input.format, overrides: input.overrides, options: input.options, scheduledAt: input.scheduledAt };
        if (existing && !mutable(existing)) {
          for (const [key, value] of Object.entries(fields)) if (JSON.stringify(existing[key as keyof Destination]) !== JSON.stringify(value)) throw new Error("This destination is already submitted. Cancel or reconcile it before changing delivery details.");
          return existing;
        }
        return resetDestination(p.id, input, existing);
      });
    }
    for (const d of p.destinations) if (mutable(d)) { d.payload = null; d.payloadHash = null; }
    checkReservations(p);
  }));
}
export function approveVideo(id: string, expectedProjectRevision: number, actor: "human" | "agent" | "system" = "human") {
  const p = store.publication(id), { edl } = readEditor(p.projectId);
  const operations = [];
  if (edl.clips.some(c => c.id === p.sequenceId)) operations.push({ type: "clip.promote", clipId: p.sequenceId });
  operations.push({ type: "sequence.plan.patch", sequenceId: p.sequenceId, patch: { status: "approved" } });
  editProject(p.projectId, { expectedRevision: expectedProjectRevision, operations }, { actor: actor === "system" ? "agent" : actor });
  return detail(store.publication(id));
}
export async function pin(id: string, revision: number, render: boolean) {
  const p = store.publication(id); if (p.revision !== revision) throw new store.PublishingConflict(p); assertEditable(p);
  const artifact = await pinExport(p.projectId, p.sequenceId, render);
  return detail(store.change(id, revision, current => { assertEditable(current); current.artifactId = artifact.id; current.phoneSource = null; for (const d of current.destinations) { d.payload = null; d.payloadHash = null; } }));
}
export function validate(id: string) {
  const p = store.publication(id), accounts = store.accounts();
  const issues = validatePublication(p, accounts, store.connections(), p.artifactId ? store.artifact(p.artifactId) : null, videoFacts(p).approved);
  const identity = (accountId: string) => accounts.find(a => a.id === accountId)?.equivalentTo ?? accountId;
  for (const d of p.destinations.filter(d => ["not_sent", "failed"].includes(d.state))) {
    const unsettled = store.publications().some(other => other.id !== p.id && other.projectId === p.projectId && other.sequenceId === p.sequenceId && other.destinations.some(previous => identity(previous.accountId) === identity(d.accountId) && ["queued", "sending", "unknown", "cancel_pending"].includes(previous.state)));
    if (unsettled) issues.push({ destinationId: d.id, field: "delivery", message: "Another release of this video has an unfinished or uncertain delivery to this account. Reconcile it before changing route or sending again." });
  }
  return issues;
}
export function occupancy(exclude?: string): Occupancy[] {
  return [...externalOccupancy(), ...store.publications().filter(p => p.id !== exclude && !p.archived).flatMap(p => p.destinations.filter(d => d.state !== "cancelled").flatMap(d => {
    const at = d.confirmedAt ?? intendedTime(p, d); return at ? [{ accountId: store.account(d.accountId).equivalentTo ?? d.accountId, at, publicationId: p.id }] : [];
  }))];
}
export function checkReservations(p: Publication) {
  const occupied = occupancy(p.id), gap = store.settings().minGapMinutes * 60_000;
  for (const d of p.destinations) {
    const at = intendedTime(p, d); if (!at || d.state === "cancelled") continue;
    if (!Number.isFinite(Date.parse(at))) throw new Error("Invalid publication time");
    const account = store.account(d.accountId), accountId = account.equivalentTo ?? account.id;
    if (occupied.some(o => o.accountId === accountId && Math.abs(Date.parse(o.at) - Date.parse(at)) < gap)) throw new Error(`This slot conflicts with another publication for ${account.name}`);
  }
}
export function slots(ids: string[], from: string, days: number, reserve: boolean, revisions: Record<string, number>) {
  const run = () => {
    const publications = [...new Set(ids)].map(store.publication);
    if (publications.some(p => p.destinations.some(d => d.scheduledAt))) throw new Error("This batch has destination-specific reservations. Clear or edit those explicitly before assigning shared slots.");
    for (const p of publications) { assertEditable(p); if (reserve && revisions[p.id] !== p.revision) throw new store.PublishingConflict(p); }
    const preserved = publications.filter(p => p.scheduledAt).map(p => ({ publicationId: p.id, at: p.scheduledAt! }));
    const unreserved = publications.filter(p => !p.scheduledAt);
    const plan = planSlots(unreserved.map(p => ({ publicationId: p.id, priority: p.priority, expiresAt: p.expiresAt, accountIds: p.destinations.map(d => store.account(d.accountId).equivalentTo ?? d.accountId) })), store.settings(), occupancy(), from, days);
    if (reserve) for (const item of plan.placements) { const p = publications.find(p => p.id === item.publicationId)!; p.scheduledAt = item.at; p.timezone = store.settings().timezone; p.destinations.forEach(d => { d.scheduledAt = null; d.payload = null; d.payloadHash = null; }); p.revision++; p.updatedAt = Date.now(); store.savePublication(p); }
    return { ...plan, placements: [...preserved, ...plan.placements] };
  };
  return reserve ? store.transaction(run) : run();
}
export async function dispatch(id: string, revision: number) {
  const before = store.publication(id);
  if (!before.artifactId) throw new Error("Pin an export first");
  await verifyArtifact(before.artifactId);
  return detail(store.change(id, revision, p => {
    const issues = validate(p.id); if (issues.length) throw new Error(issues.map(i => i.message).join("\n"));
    checkReservations(p);
    for (const d of p.destinations) {
      if (d.state !== "not_sent" && d.state !== "failed") continue;
      if (d.payload || d.remoteId) store.put("delivery-history", randomUUID(), { publicationId: p.id, destination: structuredClone(d), at: Date.now() });
      d.remoteId = null; d.remoteUrl = null; d.confirmedAt = null; d.publishedAt = null; d.checkedAt = null; d.evidence = [];
      store.remove("retry", d.id);
      const a = store.account(d.accountId), copy = resolveCopy(p.copy, d);
      d.payload = { artifactId: p.artifactId!, accountId: a.id, connectionId: a.connectionId, remoteAccountId: a.remoteId, network: a.network, format: d.format, title: copy.title, caption: caption(copy), hashtags: copy.hashtags, options: d.options, scheduledAt: intendedTime(p, d), timezone: p.timezone };
      d.payloadHash = createHash("sha256").update(JSON.stringify(d.payload)).digest("hex");
      d.state = "queued"; d.error = null;
    }
  }));
}
export function saveSettings(input: unknown) { const next = PublishingSettings.parse(input); new Intl.DateTimeFormat("en", { timeZone: next.timezone }); return store.transaction(() => { const previous = store.settings(); if (next.revision !== previous.revision) throw new store.PublishingConflict(previous); next.revision++; store.put("settings", "workspace", next); return next; }); }
export function applyCopy(id: string, revision: number, copy: Copy) { return patch(id, revision, { copy }); }
