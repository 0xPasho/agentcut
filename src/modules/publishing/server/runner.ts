import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ROOT, WORKSPACE } from "../../../common/server/config";
import type { Destination, ProviderResult } from "../types";
import * as store from "./store";
import { cancelRemote, remoteStatus, send, rescheduleRemote } from "./providers/registry";
import { checkReservations } from "./service";
import { DeliveryError } from "./providers/http";

export function launchRunner(phoneSessionId?: string) {
  const dir = path.join(WORKSPACE, "publishing"); fs.mkdirSync(dir, { recursive: true });
  const fd = fs.openSync(path.join(dir, "runner.log"), "a", 0o600);
  try {
    const child = spawn(process.execPath, ["--import", path.join(ROOT, "node_modules", "tsx", "dist", "loader.mjs"), path.join(ROOT, "scripts", "publishing-runner.ts"), ...(phoneSessionId ? ["--phone", phoneSessionId] : [])], { cwd: ROOT, env: process.env, detached: true, stdio: ["ignore", fd, fd] });
    child.on("error", () => { fs.appendFileSync(path.join(dir, "runner.log"), "Could not start publishing worker. Run agentcut publishing tick to recover queued work.\n"); });
    child.unref(); return { pid: child.pid };
  } finally { fs.closeSync(fd); }
}
export function recordResult(id: string, destinationId: string, result: ProviderResult, expected?: Destination) {
  return store.transaction(() => { const p = store.publication(id), d = p.destinations.find(d => d.id === destinationId); if (!d) throw new Error("Destination not found"); if (expected && (d.state !== expected.state || d.payloadHash !== expected.payloadHash || d.remoteId !== expected.remoteId || d.checkedAt !== expected.checkedAt)) return p; Object.assign(d, result, { checkedAt: Date.now() }); p.revision++; p.updatedAt = Date.now(); store.savePublication(p); return p; });
}
/** A durable journal handles crashes; the network request is never inside the transaction. */
export async function tick(owner: string = randomUUID()) {
  if (!store.claimLease("runner", owner, 90_000)) return { busy: true, pending: true };
  const heartbeat = setInterval(() => store.claimLease("runner", owner, 90_000), 20_000);
  try {
    for (const attempt of store.pendingAttempts()) {
      if (attempt.owner === owner || attempt.startedAt > Date.now() - 90_000) continue;
      const p = store.publication(attempt.publicationId), d = p.destinations.find(d => d.id === attempt.destinationId);
      if (d?.state === "sending" || d?.state === "cancel_pending") recordResult(p.id, d.id, { state: d.state === "cancel_pending" ? "cancel_pending" : "unknown", error: "The previous process stopped during submission. Check the remote result before retrying." });
      store.finishAttempt(attempt.id, "unknown after process interruption");
    }
    for (const p of store.publications()) for (const d of p.destinations) {
      const account = store.account(d.accountId), c = store.connection(account.connectionId);
      if (c.provider === "iphone") continue;
      if (d.state === "queued" && d.payload) {
        const retry = store.document("retry", d.id) as { hash: string; count: number; after: number } | null;
        if (retry?.hash === d.payloadHash && retry.after > Date.now()) continue;
        if (d.payload.scheduledAt && Date.parse(d.payload.scheduledAt) <= Date.now()) { recordResult(p.id, d.id, { state: "failed", error: "The local dispatch deadline passed. Choose a new time or explicitly publish now." }, d); continue; }
        const claimed = store.transaction(() => {
          const current = store.publication(p.id), dest = current.destinations.find(value => value.id === d.id);
          if (!dest || dest.state !== "queued" || !dest.payload || dest.payloadHash !== d.payloadHash) return null;
          const attempt = store.beginAttempt(current, dest.id, "publish", owner);
          dest.state = "sending"; dest.error = null; current.revision++; store.savePublication(current);
          return { attempt, payload: dest.payload };
        });
        if (!claimed) continue;
        const { attempt } = claimed;
        try { const result = await send(claimed.payload); recordResult(p.id, d.id, result); store.finishAttempt(attempt, result.state); }
        catch (error) {
          const count = retry?.hash === d.payloadHash ? retry.count : 0;
          if (error instanceof DeliveryError && !error.uncertain && error.retryAfter > 0 && count < 5) {
            const delay = Math.min(3600, Math.max(error.retryAfter, 30 * 2 ** count));
            store.put("retry", d.id, { hash: d.payloadHash, count: count + 1, after: Date.now() + delay * 1000 });
            recordResult(p.id, d.id, { state: "queued", error: `Provider rate limit. Retry ${count + 1}/5 in ${delay} seconds.` });
            store.finishAttempt(attempt, "rate limited before acceptance");
          } else {
            const state = error instanceof DeliveryError && !error.uncertain ? "failed" : "unknown";
            recordResult(p.id, d.id, { state, error: (error as Error).message }); store.finishAttempt(attempt, state);
          }
        }
      } else if (!store.leaseHeld(`destination:${d.id}`) && ["scheduled", "sending", "unknown", "cancel_pending"].includes(d.state) && d.remoteId && Date.now() - (d.checkedAt ?? 0) > 60_000) {
        try { recordResult(p.id, d.id, await observedRemote(c.id, d), d); }
        catch (error) { recordResult(p.id, d.id, { state: d.state, error: (error as Error).message }, d); }
      }
    }
    return { busy: false, pending: store.publications().some(p => p.destinations.some(d => store.connection(store.account(d.accountId).connectionId).provider !== "iphone" && (["queued", "sending", "scheduled", "cancel_pending"].includes(d.state) || (d.state === "unknown" && !!d.remoteId)))) };
  } finally { clearInterval(heartbeat); store.releaseLease("runner", owner); }
}
async function observedRemote(connectionId: string, destination: Destination): Promise<ProviderResult> {
  try { return await remoteStatus(connectionId, destination.remoteId!); }
  catch (error) {
    if (destination.state === "cancel_pending" && error instanceof DeliveryError && error.status === 404) return { state: "cancelled", error: null };
    throw error;
  }
}
export async function refresh(id: string) {
  const p = store.publication(id);
  for (const d of p.destinations) { const c = store.connection(store.account(d.accountId).connectionId); if (c.provider !== "iphone" && d.remoteId && d.state !== "cancelled" && !store.leaseHeld(`destination:${d.id}`)) recordResult(id, d.id, await observedRemote(c.id, d), d); }
  return store.publication(id);
}
export async function cancel(id: string, revision: number, destinationId: string) {
  const p = store.publication(id); if (p.revision !== revision) throw new store.PublishingConflict(p);
  const d = p.destinations.find(d => d.id === destinationId); if (!d) throw new Error("Destination not found");
  if (["published", "sending", "unknown"].includes(d.state)) throw new Error("Reconcile this destination first. A published post is history, not a pending cancellation.");
  if (["not_sent", "queued", "failed", "cancelled"].includes(d.state) && !d.remoteId) return store.change(id, revision, current => { const dest = current.destinations.find(x => x.id === destinationId)!; dest.state = "cancelled"; dest.payload = null; dest.payloadHash = null; });
  const c = store.connection(store.account(d.accountId).connectionId);
  const owner = randomUUID();
  if (!store.claimLease(`destination:${d.id}`, owner, 180_000)) throw new Error("Another destination action is still running");
  let attempt: string | null = null;
  try {
    store.change(id, revision, current => {
      current.destinations.find(x => x.id === destinationId)!.state = "cancel_pending";
      if (c.provider !== "iphone") attempt = store.beginAttempt(current, d.id, "cancel", owner);
    });
    if (c.provider === "iphone") return store.publication(id);
    if (!d.remoteId) throw new Error("Remote ID is missing. Reconcile before cancellation.");
    await cancelRemote(c.id, d.remoteId);
    const result = recordResult(id, d.id, { state: "cancelled", error: null });
    store.finishAttempt(attempt!, "cancelled"); return result;
  } catch (error) {
    if (attempt) { recordResult(id, d.id, { state: "cancel_pending", error: (error as Error).message }); store.finishAttempt(attempt, "unconfirmed"); }
    throw error;
  } finally { store.releaseLease(`destination:${d.id}`, owner); }
}
export async function moveRemote(id: string, revision: number, destinationId: string, at: string) {
  const p = store.publication(id); if (p.revision !== revision) throw new store.PublishingConflict(p);
  const d = p.destinations.find(d => d.id === destinationId); if (!d || d.state !== "scheduled") throw new Error("Only a confirmed scheduled destination can be moved remotely");
  const c = store.connection(store.account(d.accountId).connectionId);
  if (c.provider === "iphone") throw new Error("Cancel this schedule in a phone session, verify cancellation, then prepare a new release with the new time.");
  if (!d.remoteId) throw new Error("Missing remote ID");
  const owner = randomUUID(); if (!store.claimLease(`destination:${d.id}`, owner, 180_000)) throw new Error("This destination has another action in progress");
  let attempt: string | null = null;
  try {
    store.change(id, revision, current => {
      const dest = current.destinations.find(x => x.id === d.id)!;
      if (dest.state !== "scheduled") throw new Error("The destination changed before rescheduling");
      const proposed = structuredClone(current); proposed.destinations.find(x => x.id === d.id)!.scheduledAt = at;
      checkReservations(proposed);
      if (!Number.isFinite(Date.parse(at)) || Date.parse(at) <= Date.now()) throw new Error("Choose a future publication time");
      attempt = store.beginAttempt(current, d.id, "reschedule", owner);
      dest.state = "unknown"; dest.error = "Schedule change in progress. The previous confirmed time is retained until verified.";
    });
    const result = await rescheduleRemote(c.id, d.remoteId, at);
    const updated = store.transaction(() => { const current = store.publication(id), dest = current.destinations.find(x => x.id === d.id)!; Object.assign(dest, result); dest.scheduledAt = at; current.revision++; store.savePublication(current); return current; });
    store.finishAttempt(attempt!, result.state); return updated;
  } catch (error) {
    if (attempt) {
      recordResult(id, d.id, { state: "unknown", error: "Schedule change is unconfirmed; refresh before retrying. The previous confirmed time is retained." });
      store.finishAttempt(attempt, "unconfirmed");
    }
    throw error;
  } finally { store.releaseLease(`destination:${d.id}`, owner); }
}
