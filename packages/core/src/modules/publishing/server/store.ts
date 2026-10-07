import { randomUUID } from "node:crypto";
import { db } from "../../../common/server/db";
import { connectionSecret, setConnectionSecret } from "../../../common/server/secrets";
import { Account, Artifact, Connection, PhoneSession, Publication, PublishingSettings } from "../types";
import type { Attempt } from "../types";

// Publishing state is independent of the EDL. One transaction protects each command.
db.exec(`
 CREATE TABLE IF NOT EXISTS publishing_records (kind TEXT NOT NULL, id TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0, document TEXT NOT NULL, PRIMARY KEY(kind,id));
 CREATE TABLE IF NOT EXISTS publication_attempts (id TEXT PRIMARY KEY, publication_id TEXT NOT NULL, destination_id TEXT NOT NULL, action TEXT NOT NULL, hash TEXT NOT NULL, started_at INTEGER NOT NULL, ended_at INTEGER, result TEXT NOT NULL, owner TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS publication_attempts_pending ON publication_attempts(ended_at, started_at);
 CREATE TABLE IF NOT EXISTS publishing_leases (id TEXT PRIMARY KEY, owner TEXT NOT NULL, until_at INTEGER NOT NULL);
`);
export class PublishingConflict extends Error {
  constructor(public current: unknown) { super("This publication changed elsewhere. Reload before applying your changes."); }
}
export function transaction<T>(fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try { const result = fn(); db.exec("COMMIT"); return result; } catch (error) { db.exec("ROLLBACK"); throw error; }
}
export function documents(kind: string): unknown[] { return (db.prepare("SELECT document FROM publishing_records WHERE kind = ? ORDER BY rowid").all(kind) as Array<{ document: string }>).map(r => JSON.parse(r.document)); }
export function document(kind: string, id: string): unknown | null { const row = db.prepare("SELECT document FROM publishing_records WHERE kind = ? AND id = ?").get(kind, id) as { document: string } | undefined; return row ? JSON.parse(row.document) : null; }
export function remove(kind: string, id: string) { db.prepare("DELETE FROM publishing_records WHERE kind=? AND id=?").run(kind, id); }
export function put(kind: string, id: string, value: unknown, revision = 0) { db.prepare("INSERT INTO publishing_records(kind,id,revision,document) VALUES(?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET document=excluded.document, revision=excluded.revision").run(kind, id, revision, JSON.stringify(value)); }
export const publications = () => documents("publication").map(p => Publication.parse(p));
export function publication(id: string) { const raw = document("publication", id); if (!raw) throw new Error("Publication not found"); return Publication.parse(raw); }
export function savePublication(p: Publication) { put("publication", p.id, p, p.revision); return p; }
export function change(id: string, revision: number, update: (p: Publication) => void) {
  return transaction(() => { const p = publication(id); if (p.revision !== revision) throw new PublishingConflict(p); update(p); p.revision++; p.updatedAt = Date.now(); return savePublication(Publication.parse(p)); });
}
export const accounts = () => documents("account").map(a => Account.parse(a));
export function account(id: string) { const a = accounts().find(a => a.id === id); if (!a) throw new Error("Account not found"); return a; }
export const connections = () => documents("connection").map(c => Connection.parse(c));
export function connection(id: string) { const c = connections().find(c => c.id === id); if (!c) throw new Error("Connection not found"); return c; }
export const artifact = (id: string) => Artifact.parse(document("artifact", id));
export const settings = () => PublishingSettings.parse(document("settings", "workspace") ?? {});
export const sessions = () => documents("session").map(s => PhoneSession.parse(s));
export const session = (id: string) => PhoneSession.parse(document("session", id));
export const secret = connectionSecret;
export const setSecret = setConnectionSecret;
export function claimLease(id: string, owner: string, ttl = 60_000): boolean {
  const now = Date.now();
  return Number(db.prepare("INSERT INTO publishing_leases(id,owner,until_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,until_at=excluded.until_at WHERE publishing_leases.until_at < ? OR publishing_leases.owner = ?").run(id, owner, now + ttl, now, owner).changes) > 0;
}
export function leaseHeld(id: string) { return !!db.prepare("SELECT 1 FROM publishing_leases WHERE id=? AND until_at > ?").get(id, Date.now()); }
export function releaseLease(id: string, owner: string) { db.prepare("DELETE FROM publishing_leases WHERE id=? AND owner=?").run(id, owner); }
export function beginAttempt(p: Publication, destinationId: string, action: Attempt["action"], owner: string): string {
  const id = randomUUID();
  db.prepare("INSERT INTO publication_attempts VALUES(?,?,?,?,?,?,NULL,?,?)").run(id, p.id, destinationId, action, p.destinations.find(d => d.id === destinationId)?.payloadHash ?? "", Date.now(), "started", owner);
  return id;
}
export function finishAttempt(id: string, result: string) { db.prepare("UPDATE publication_attempts SET ended_at=?,result=? WHERE id=?").run(Date.now(), result, id); }
export function pendingAttempts() { return db.prepare("SELECT id,publication_id AS publicationId,destination_id AS destinationId,started_at AS startedAt,owner FROM publication_attempts WHERE ended_at IS NULL").all() as Array<Pick<Attempt, "id" | "publicationId" | "destinationId" | "startedAt" | "owner">>; }
