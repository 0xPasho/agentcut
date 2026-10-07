import path from "node:path";
import { randomUUID } from "node:crypto";
import { WORKSPACE } from "../../../../common/server/config";
import { PhoneSession } from "../../types";
import type { PhoneAction, PublicationCommand } from "../../types";
import { PHONE_GUIDE } from "../../data";
import * as store from "../store";
import { verifyArtifact } from "../artifacts";
import { act, phoneReadiness } from "./control";

export function sessionDir(id: string) { if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid session"); return path.join(WORKSPACE, "publishing", "phone", id); }
export function evidenceFile(sessionId: string, evidenceId: string) { if (!/^[a-f0-9-]{36}$/.test(evidenceId)) throw new Error("Invalid screenshot"); const s = store.session(sessionId); if (!s.evidence.includes(evidenceId)) throw new Error("Screenshot not found"); return path.join(sessionDir(sessionId), `${evidenceId}.png`); }
function active(id: string) {
  const s = store.session(id);
  if (s.status !== "active") throw new Error("Resume this phone session before continuing");
  if (!store.claimLease("phone", id, 300_000)) throw new Error("Another session owns the phone");
  const p = store.publication(s.publicationId);
  for (const destinationId of s.destinationIds) { const d = p.destinations.find(d => d.id === destinationId); if (!d || d.payloadHash !== s.hashes[destinationId]) throw new Error("Approved payload changed. Stop and review this publication."); }
  s.leaseUntil = Date.now() + 300_000; store.put("session", id, s); return { s, p };
}
export function checklist(id: string) { const s = store.session(id), p = store.publication(s.publicationId); return { session: s, source: p.phoneSource, artifact: p.artifactId ? store.artifact(p.artifactId) : null, destinations: p.destinations.filter(d => s.destinationIds.includes(d.id)).map(d => ({ ...d, account: store.account(d.accountId) })), guide: PHONE_GUIDE }; }
export async function startPhone(id: string) {
  const p = store.publication(id);
  if (!p.artifactId || !p.phoneSource || p.phoneSource.artifactId !== p.artifactId) throw new Error("Identify the phone copy of the pinned export first");
  await verifyArtifact(p.artifactId);
  const readiness = await phoneReadiness(); if (!readiness.ready) throw new Error(readiness.message);
  return store.transaction(() => {
    const current = store.publication(id);
    const destinations = current.destinations.filter(d => store.connection(store.account(d.accountId).connectionId).provider === "iphone" && ["queued", "unknown", "cancel_pending", "scheduled"].includes(d.state));
    if (!destinations.length || destinations.some(d => !d.payloadHash)) throw new Error("Queue the approved phone destinations before starting a session");
    if (current.expiresAt && Date.parse(current.expiresAt) <= Date.now()) throw new Error("This publication has expired. Review it before starting the phone session");
    const existing = store.sessions().find(s => s.publicationId === id && s.status === "active");
    if (existing) { active(existing.id); return checklist(existing.id); }
    const sessionId = randomUUID(), now = Date.now();
    if (!store.claimLease("phone", sessionId, 300_000)) throw new Error("Finish or abort the current phone session first");
    const s = PhoneSession.parse({ id: sessionId, publicationId: id, destinationIds: destinations.map(d => d.id), hashes: Object.fromEntries(destinations.map(d => [d.id, d.payloadHash])), status: "active", step: "Verify the source video and account identities", evidence: [], leaseUntil: now + 300_000, createdAt: now, updatedAt: now });
    for (const d of destinations) if (d.state === "queued") d.state = "sending";
    current.revision++; store.savePublication(current); store.put("session", s.id, s); return checklist(s.id);
  });
}
export async function resumePhone(id: string) {
  const s = store.session(id); if (s.status === "done") return checklist(id);
  const publication = store.publication(s.publicationId);
  if (!publication.artifactId) throw new Error("Pinned export is missing");
  await verifyArtifact(publication.artifactId);
  if (!store.claimLease("phone", id, 300_000)) throw new Error("Another session owns the phone");
  s.status = "active"; s.updatedAt = Date.now(); s.leaseUntil = Date.now() + 300_000; store.put("session", id, s); active(id); return checklist(id);
}
export async function phoneAction(id: string, action: PhoneAction, note: string) {
  const { s } = active(id), owner = randomUUID();
  if (!store.claimLease(`phone-action:${id}`, owner, 120_000)) throw new Error("A phone action is still running");
  const heartbeat = setInterval(() => { store.claimLease(`phone-action:${id}`, owner, 120_000); store.claimLease("phone", id, 300_000); }, 20_000);
  try {
    const beforeId = randomUUID();
    await act({ kind: "screen" }, path.join(sessionDir(id), `${beforeId}.png`));
    active(id);
    const evidenceId = randomUUID();
    const window = await act(action, path.join(sessionDir(id), `${evidenceId}.png`));
    const current = store.session(id); current.evidence.push(beforeId, evidenceId); current.step = note; current.updatedAt = Date.now(); store.put("session", s.id, current);
    return { evidenceId, image: evidenceFile(id, evidenceId), window, instruction: "Inspect this screenshot before deciding the next step." };
  } finally {
    clearInterval(heartbeat);
    store.releaseLease(`phone-action:${id}`, owner);
    if (store.session(id).status !== "active") store.releaseLease("phone", id);
  }
}
export function recordPhone(input: Extract<PublicationCommand, { tool: "publication.phone.record" }>) {
  return store.transaction(() => {
    if (store.leaseHeld(`phone-action:${input.sessionId}`)) throw new Error("Wait for the current phone action and screenshot before recording its result");
    const { s, p } = active(input.sessionId), d = p.destinations.find(d => d.id === input.destinationId);
    if (!d || !s.destinationIds.includes(d.id)) throw new Error("Destination is not part of this session");
    if (["published", "cancelled"].includes(d.state)) throw new Error("This destination is already final; create a repeat publication for another delivery");
    if (!s.evidence.includes(input.evidenceId)) throw new Error("Capture verification evidence in this session first");
    if (input.outcome === "scheduled" && (!input.at || Date.parse(input.at) <= Date.now())) throw new Error("A confirmed schedule needs the observed future time");
    if (input.outcome === "scheduled" && input.at && Date.parse(input.at) !== Date.parse(d.payload?.scheduledAt ?? "")) throw new Error("The observed schedule differs from the approved time. Correct it in the app before marking it confirmed.");
    if (input.outcome === "cancelled" && d.state !== "cancel_pending") throw new Error("Request cancellation before confirming it");
    d.state = input.outcome; d.checkedAt = Date.now(); d.remoteUrl = input.remoteUrl;
    if (input.outcome === "scheduled") d.confirmedAt = input.at;
    if (input.outcome === "published") d.publishedAt = input.at ?? new Date().toISOString();
    d.error = input.outcome === "unknown" ? input.note : null; d.evidence.push(input.evidenceId);
    p.revision++; store.savePublication(p);
    s.step = input.note; s.updatedAt = Date.now();
    if (s.destinationIds.every(id => ["scheduled", "published", "cancelled"].includes(p.destinations.find(d => d.id === id)!.state))) { s.status = "done"; store.releaseLease("phone", s.id); }
    store.put("session", s.id, s); return checklist(s.id);
  });
}
export function abortPhone(id: string, reason: string) {
  return store.transaction(() => { const s = store.session(id), p = store.publication(s.publicationId); s.status = "aborted"; s.step = reason; s.updatedAt = Date.now();
    for (const d of p.destinations.filter(d => s.destinationIds.includes(d.id))) if (d.state === "sending") { d.state = "unknown"; d.error = "Session stopped. Verify the app before submitting again."; }
    p.revision++; store.savePublication(p); store.put("session", id, s);
    if (!store.leaseHeld(`phone-action:${id}`)) store.releaseLease("phone", id);
    return s;
  });
}
