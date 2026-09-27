import fs from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { Destination, Publication, CadenceRow } from "../types";
import type { ImportPreview, ImportSourceMap } from "../types";
import { FORMATS } from "../data";
import * as store from "./store";
import { readEditor } from "../../editor/server/store";
import { WORKSPACE } from "../../../common/server/config";
import { captureArtifact, fileHash } from "./artifacts";

async function sourcePosts(file: string): Promise<unknown[]> {
  if (path.extname(file) === ".json") { const raw = JSON.parse(await fs.readFile(file, "utf8")); return z.array(z.unknown()).parse(Array.isArray(raw) ? raw : raw.posts); }
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    db.exec("BEGIN");
    const posts = db.prepare("SELECT id,title,caption,scheduled_at,origin,created_at,media_ids FROM posts").all();
    const destinations = db.prepare("SELECT id,post_id,account_id,network,caption,title,hashtags,settings,scheduled_at,status,remote_id,remote_url,published_at FROM destinations").all();
    const hasMedia = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='media'").get();
    const media = hasMedia ? db.prepare("SELECT id,path,sha256 FROM media").all() : [];
    return posts.map(p => {
      const mediaIds = JSON.parse(String(p.media_ids));
      return { id: p.id, title: p.title, caption: p.caption, scheduledAt: p.scheduled_at, origin: JSON.parse(String(p.origin ?? "null")), createdAt: p.created_at,
        media: media.filter(m => mediaIds.includes(m.id)).map(m => ({ path: m.path, sha256: m.sha256 })),
        destinations: destinations.filter(d => d.post_id === p.id).map(d => ({ id: d.id, accountId: d.account_id, network: d.network, caption: d.caption, title: d.title, hashtags: JSON.parse(String(d.hashtags)), settings: JSON.parse(String(d.settings)), scheduledAt: d.scheduled_at, status: d.status, remoteId: d.remote_id, remoteUrl: d.remote_url, publishedAt: d.published_at })) };
    });
  } finally { db.close(); }
}
export async function previewImport(file: string, accountMap: Record<string, string> = {}, sourceMap: ImportSourceMap = {}): Promise<ImportPreview> {
  const absolute = path.resolve(file), source = createHash("sha256").update(absolute).digest("hex"), entries: Publication[] = [], issues: ImportPreview["issues"] = [], artifacts: ImportPreview["artifacts"] = [], provenance: ImportPreview["provenance"] = [];
  let existing = 0;
  for (const raw of await sourcePosts(absolute)) {
    const parsed = CadenceRow.safeParse(raw);
    if (!parsed.success) { issues.push({ id: "invalid-row", message: "A source row does not match the supported Cadence export schema. It was skipped." }); continue; }
    const input = parsed.data, origin = `cadence:${input.id}`;
    // Cadence post IDs are stable across backups and exported copies; a file path is not identity.
    if (store.publications().some(p => p.origin === origin || p.origin?.endsWith(`:${input.id}`))) { existing++; continue; }
    const mapped = sourceMap[input.id], projectId = mapped?.projectId ?? input.origin?.ref ?? "", sequenceId = mapped?.sequenceId ?? input.origin?.detail ?? "";
    try { const { edl } = readEditor(projectId); if (![...edl.sequences, ...edl.clips].some(v => v.id === sequenceId)) throw new Error(); }
    catch { issues.push({ id: input.id, message: "Source project/video missing. Map this Cadence post to an existing Agentcut video." }); continue; }
    const destinations = input.destinations.flatMap(d => {
      const accountId = accountMap[d.accountId] ?? d.accountId, a = store.accounts().find(a => a.id === accountId);
      if (!a || a.network !== d.network) { issues.push({ id: input.id, message: `Map Cadence account ${d.accountId} (${d.network}) to an Agentcut account.` }); return []; }
      const format = Object.entries(FORMATS).find(([id, f]) => id !== "youtube-video" && f.network === a.network)![0];
      const known = d.status === "published" || (d.status === "scheduled" && !!d.remoteId && !d.remoteId.startsWith("phone:"));
      return [Destination.parse({ id: randomUUID(), accountId, format, overrides: { title: d.title, description: d.caption, hashtags: d.hashtags.map(t => t.replace(/^#/, "")) }, scheduledAt: d.scheduledAt, state: known ? d.status : "unknown", remoteId: d.remoteId?.startsWith("phone:") ? null : d.remoteId, remoteUrl: d.remoteUrl, publishedAt: d.publishedAt, confirmedAt: known ? d.scheduledAt ?? input.scheduledAt : null, error: known ? null : "Imported without a verified delivery result. Reconcile in the app/provider before retrying." })];
    });
    if (destinations.length !== input.destinations.length) continue;
    const p = Publication.parse({ id: randomUUID(), projectId, sequenceId, label: input.title, copy: { title: input.title, description: input.caption, hashtags: [] }, scheduledAt: input.scheduledAt, timezone: input.timezone ?? store.settings().timezone, artifactId: null, destinations, revision: 0, createdAt: input.createdAt ?? Date.now(), updatedAt: Date.now(), origin });
    entries.push(p); provenance.push({ publicationId: p.id, sourcePost: input });
    if (input.media.length === 1) {
      const media = input.media[0], sourcePath = path.resolve(path.dirname(absolute), media.path);
      try { const sha256 = await fileHash(sourcePath); if (media.sha256 && media.sha256 !== sha256) throw new Error(); artifacts.push({ publicationId: p.id, path: sourcePath, sha256 }); }
      catch { issues.push({ id: input.id, message: "Original media is missing or its checksum differs. History can be imported, but the export must be reviewed before a future delivery." }); }
    } else issues.push({ id: input.id, message: "No unambiguous single video export was found. Select and pin the original video before any future delivery." });
    if (input.destinations.some(d => Object.keys(d.settings).length)) issues.push({ id: input.id, message: "Original platform settings are retained in provenance. Review supported options explicitly before a future delivery." });
  }
  return { source, entries, issues, existing, artifacts, provenance };
}
export async function applyImport(file: string, accountMap: Record<string, string>, sourceMap: ImportSourceMap = {}) {
  const preview = await previewImport(file, accountMap, sourceMap);
  const importId = randomUUID(), backupDir = path.join(WORKSPACE, "publishing", "imports");
  await fs.mkdir(backupDir, { recursive: true });
  await fs.writeFile(path.join(backupDir, `${importId}.json`), JSON.stringify({ createdAt: Date.now(), publications: store.publications() }), { mode: 0o600, flag: "wx" });
  for (const candidate of preview.artifacts) {
    const p = preview.entries.find(p => p.id === candidate.publicationId)!;
    if (await fileHash(candidate.path) !== candidate.sha256) throw new Error("Import media changed after preview. Preview the source again.");
    const captured = await captureArtifact(p.projectId, p.sequenceId, -1, `cadence:${candidate.sha256}`, candidate.path);
    if (captured.sha256 !== candidate.sha256) throw new Error("Import media changed while copying. Nothing was submitted.");
    p.artifactId = captured.id;
  }
  return store.transaction(() => {
    const insertedIds: string[] = [];
    for (const p of preview.entries) {
      if (store.publications().some(old => old.origin === p.origin)) continue;
      store.savePublication(p); insertedIds.push(p.id);
      store.put("import-provenance", p.id, preview.provenance.find(item => item.publicationId === p.id));
    }
    store.put("import", importId, { ids: insertedIds, createdAt: Date.now() });
    return { importId, inserted: insertedIds.length, existing: preview.existing, issues: preview.issues };
  });
}
export function rollbackImport(importId: string) {
  return store.transaction(() => {
    const batch = store.document("import", importId) as { ids: string[] } | null;
    if (!batch) throw new Error("Import not found");
    const records = batch.ids.map(store.publication);
    if (records.some(p => p.revision !== 0)) throw new Error("An imported publication has changed. Scoped rollback only removes untouched imports.");
    for (const p of records) store.remove("publication", p.id);
    store.put("import", importId, { ids: [], rolledBackAt: Date.now() });
    return { removed: records.length };
  });
}
