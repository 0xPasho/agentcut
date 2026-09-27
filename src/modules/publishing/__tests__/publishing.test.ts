import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { spawnSync } from "node:child_process";
import { Destination, Publication, PublishingSettings, Account, Connection } from "../types";
import { caption, publicationStatus, resolveCopy } from "../lib/resolve";
import { localInstant, planSlots } from "../lib/schedule";
import { validatePublication } from "../lib/validate";
import { FFMPEG } from "../../../common/server/bin";

let workspace: string;
let store: typeof import("../server/store");
let service: typeof import("../server/service");
let database: typeof import("../../../common/server/db");
let editor: typeof import("../../editor/server/store");
let artifacts: typeof import("../server/artifacts");
let create: typeof import("../../media/server/media-import");
let providers: typeof import("../server/providers/registry");
let runner: typeof import("../server/runner");
let source: string;
before(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agentcut-publishing-")); process.env.AGENTCUT_WORKSPACE = workspace;
  [store, service, database, editor, artifacts, create, providers, runner] = await Promise.all([import("../server/store"), import("../server/service"), import("../../../common/server/db"), import("../../editor/server/store"), import("../server/artifacts"), import("../../media/server/media-import"), import("../server/providers/registry"), import("../server/runner")]);
  source = path.join(workspace, "approved.mp4");
  const result = spawnSync(FFMPEG, ["-y", "-f", "lavfi", "-i", "color=blue:size=90x160:rate=10:duration=1", "-pix_fmt", "yuv420p", source], { encoding: "utf8" }); assert.equal(result.status, 0, result.stderr);
});
after(async () => { database.db.close(); await fs.rm(workspace, { recursive: true, force: true }); });

function model() { return Publication.parse({ id: "p", projectId: "project", sequenceId: "video", label: "Title", copy: { title: "Title", description: "Caption", hashtags: ["one"] }, timezone: "UTC", scheduledAt: null, artifactId: null, destinations: [Destination.parse({ id: "d", accountId: "a", format: "youtube-short" })], revision: 0, createdAt: 0, updatedAt: 0 }); }

test("copy inheritance distinguishes explicit empty and hashtags are composed only once", () => {
  const p = model(), d = p.destinations[0];
  d.overrides.description = ""; d.overrides.hashtags = [];
  assert.equal(caption(resolveCopy(p.copy, d)), "");
  d.overrides.description = null; d.overrides.hashtags = null;
  assert.equal(caption(resolveCopy(p.copy, d)), "Caption\n\n#one");
  assert.equal(caption({ title: "", description: "Text #one", hashtags: ["one", "two", "two"] }), "Text #one\n\n#two");
});
test("realistic summary never confuses draft, render, reservation and remote outcome", () => {
  const p = model(); p.scheduledAt = "2030-01-01T12:00:00Z";
  assert.equal(publicationStatus(p, false), "draft"); assert.equal(publicationStatus(p, true), "approved");
  p.destinations[0].state = "queued"; assert.equal(publicationStatus(p, true), "pending");
  p.destinations[0].state = "scheduled"; assert.equal(publicationStatus(p, true), "scheduled");
  p.destinations.push({ ...p.destinations[0], id: "second", state: "published" }); assert.equal(publicationStatus(p, true), "partial");
  p.destinations[0].state = "published"; assert.equal(publicationStatus(p, false), "published");
  p.destinations[0].state = "unknown"; assert.equal(publicationStatus(p, true), "partial");
});
test("timezone planner refuses DST folds/gaps and competes transactionally within a batch", () => {
  assert.throws(() => localInstant("2026-03-08", "02:30", "America/New_York"), /does not exist/);
  assert.throws(() => localInstant("2026-11-01", "01:30", "America/New_York"), /occurs twice/);
  assert.equal(localInstant("2026-09-28", "18:00", "America/Mexico_City"), "2026-09-29T00:00:00.000Z");
  const settings = PublishingSettings.parse({ timezone: "UTC", slots: [{ weekday: 1, time: "12:00" }, { weekday: 1, time: "13:00" }], minGapMinutes: 60, leadMinutes: 1 });
  const requests = ["one", "two", "three"].map(publicationId => ({ publicationId, accountIds: ["a"], priority: 0, expiresAt: null }));
  const result = planSlots(requests, settings, [], "2030-01-07", 1, Date.parse("2030-01-06T00:00:00Z"));
  assert.equal(result.placements.length, 2); assert.equal(result.unavailable.length, 1); assert.notEqual(result.placements[0].at, result.placements[1].at);
  const separate = planSlots(requests.slice(0, 2).map((r, n) => ({ ...r, accountIds: [String(n)] })), settings, [], "2030-01-07", 1, Date.parse("2030-01-06T00:00:00Z")); assert.equal(separate.placements[0].at, separate.placements[1].at);
});
test("validation checks account, required audience, phone source and exact scheduled time", () => {
  const p = model(), a = Account.parse({ id: "a", connectionId: "phone", remoteId: "channel", network: "youtube", name: "Channel" }), c = Connection.parse({ id: "phone", provider: "iphone", name: "Phone", baseUrl: "", configured: true });
  const issues = validatePublication(p, [a], [c], null, false);
  for (const field of ["approval", "artifact", "audience", "source"]) assert.ok(issues.some(i => i.field === field));
});
async function fixture(accountId: string) {
  const { id } = await create.createVideoProject("Publication test", [], { transcribe: false, output: { width: 90, height: 160, fps: 10 } });
  const snapshot = editor.readEditor(id), sequenceId = snapshot.edl.sequences[0].id;
  let p = service.prepare(id, sequenceId, [accountId]);
  p = service.approveVideo(p.id, snapshot.revision);
  const approved = editor.readEditor(id), a = await artifacts.captureArtifact(id, sequenceId, approved.revision, artifacts.contentSignature(approved.edl, sequenceId), source);
  store.change(p.id, p.revision, current => { current.artifactId = a.id; current.copy.description = "A verified test video"; current.destinations[0].options.madeForKids = false; current.phoneSource = { kind: "photos", folder: "", file: "approved.mp4", artifactId: a.id }; });
  return service.detail(store.publication(p.id));
}
test("source-free videos preserve existing review; UI and agent use identical revision checked state", async () => {
  const c = providers.saveConnection({ provider: "iphone", name: "Phone" }); const a = providers.addPhoneAccount(c.id, "youtube", "Channel", "channel");
  let p = await fixture(a.id);
  assert.equal(p.status, "approved"); assert.equal(p.videoApproved, true);
  const revision = p.revision;
  p = service.patch(p.id, revision, { copy: { title: "Human edit", description: "Keep me", hashtags: [] } });
  assert.throws(() => service.patch(p.id, revision, { copy: { title: "Stale", description: "Lost", hashtags: [] } }), /changed elsewhere/);
  const { executePublicationCommand } = await import("../server/tools");
  const response = await executePublicationCommand({ tool: "publication.patch", id: p.id, revision: p.revision, patch: { label: "Agent label" } }, { actor: "agent" });
  assert.equal((response as typeof p).copy.description, "Keep me");
  assert.deepEqual(service.prepare(p.projectId, p.sequenceId).id, p.id, "opening/preparing again never creates a duplicate");
});
test("pinned artifacts survive edits; tampering blocks dispatch; render is not publication", async () => {
  const c = providers.saveConnection({ provider: "iphone", name: "Phone export" }); const a = providers.addPhoneAccount(c.id, "instagram", "IG", "ig");
  const p = await fixture(a.id), original = await artifacts.verifyArtifact(p.artifactId!);
  const snapshot = editor.readEditor(p.projectId);
  editor.editProject(p.projectId, { expectedRevision: snapshot.revision, operations: [{ type: "sequence.patch", sequenceId: p.sequenceId, title: "Changed video" }] });
  assert.equal(service.detail(store.publication(p.id)).newerEdit, true);
  assert.equal((await artifacts.verifyArtifact(p.artifactId!)).sha256, original.sha256);
  await fs.appendFile(artifacts.artifactFile(p.artifactId!), "tampered");
  await assert.rejects(service.dispatch(p.id, p.revision), /export changed/);
  assert.equal(store.publication(p.id).destinations[0].state, "not_sent");
});
test("network timeout after submission becomes unknown and a runner never blindly posts again", async () => {
  let submissions = 0;
  const server = createServer(async (req, res) => {
    for await (const _chunk of req) { /* consume upload without retaining it */ }
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/media/upload") { res.end(JSON.stringify({ id: "uploaded" })); return; }
    if (req.url === "/posts/publish") { submissions++; req.socket.destroy(); return; }
    res.statusCode = 404; res.end("{}");
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  try {
    const c = providers.saveConnection({ provider: "postgun", name: "Test provider", baseUrl: `http://127.0.0.1:${port}`, key: "test-secret" });
    const a = Account.parse({ id: "api-account", connectionId: c.id, remoteId: "remote", network: "youtube", name: "API channel" }); store.put("account", a.id, a);
    const p = await fixture(a.id); await service.dispatch(p.id, p.revision);
    await runner.tick("test-runner");
    assert.equal(store.publication(p.id).destinations[0].state, "unknown"); assert.equal(submissions, 1);
    await runner.tick("test-runner"); assert.equal(submissions, 1);
    assert.ok(!JSON.stringify(service.overview()).includes("test-secret"));
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
test("cancelling queued work prevents submission and preserves completed destination history", async () => {
  const c = providers.saveConnection({ provider: "iphone", name: "Cancel phone" }); const a = providers.addPhoneAccount(c.id, "instagram", "Cancel", "cancel");
  const p = await fixture(a.id); const queued = await service.dispatch(p.id, p.revision);
  const cancelled = await runner.cancel(p.id, queued.revision, p.destinations[0].id);
  assert.equal(cancelled.destinations[0].state, "cancelled"); assert.equal(cancelled.destinations[0].payload, null);
});
test("phone recording requires a bounded session, matching approval and captured evidence", async () => {
  const { recordPhone } = await import("../server/phone/sessions");
  await assert.rejects(async () => recordPhone({ tool: "publication.phone.record", sessionId: "missing", destinationId: "d", outcome: "published", at: null, remoteUrl: null, evidenceId: "fabricated", note: "No screenshot was captured" }));
});
test("Cadence preview is read-only, import is idempotent and uncertain phone drafts never auto-send", async () => {
  const c = providers.saveConnection({ provider: "iphone", name: "Import phone" }); const a = providers.addPhoneAccount(c.id, "instagram", "Import", "import");
  const p = await fixture(a.id), file = path.join(workspace, "cadence.json");
  await fs.writeFile(file, JSON.stringify([{ id: "old", title: "Imported", caption: "Copy", origin: { ref: p.projectId, detail: p.sequenceId }, destinations: [{ accountId: "old-account", network: "instagram", status: "draft" }] }]));
  const { previewImport, applyImport } = await import("../server/import-cadence");
  const count = store.publications().length, mapping = { "old-account": a.id };
  const preview = await previewImport(file, mapping); assert.equal(store.publications().length, count); assert.equal(preview.entries[0].destinations[0].state, "unknown");
  assert.equal((await applyImport(file, mapping)).inserted, 1); assert.equal((await applyImport(file, mapping)).inserted, 0);
});
test("MCP has workspace publishing tools without requiring a dummy project", async () => {
  const { listMcpTools, callMcpTool } = await import("../../agent/server/mcp");
  const tool = listMcpTools().find(t => t.name === "agentcut_publication_overview"); assert.ok(tool);
  assert.ok(!(tool.inputSchema as { required?: string[] }).required?.includes("projectId"));
  const result = await callMcpTool("agentcut_publication_overview", {}); assert.ok(Array.isArray((result as { publications: unknown[] }).publications));
});

test("a failed destination can change without resetting its published sibling", async () => {
  const c = providers.saveConnection({ provider: "iphone", name: "Partial" });
  const a = providers.addPhoneAccount(c.id, "instagram", "Done", "partial-done");
  const b = providers.addPhoneAccount(c.id, "tiktok", "Retry", "partial-retry");
  const p = await fixture(a.id);
  const saved = store.change(p.id, p.revision, value => {
    value.destinations[0].state = "published"; value.destinations[0].remoteId = "real-post";
    value.destinations.push({ ...service.makeDestination(b.id), state: "failed", error: "Rejected" });
  });
  const before = JSON.stringify(saved.destinations[0]);
  const inputs = structuredClone(saved.destinations); inputs[1].overrides.description = "Corrected caption";
  const changed = service.patch(saved.id, saved.revision, {}, inputs);
  assert.equal(JSON.stringify(changed.destinations[0]), before);
  assert.equal(changed.destinations[1].state, "not_sent");
  assert.equal(changed.destinations[1].overrides.description, "Corrected caption");
  assert.throws(() => service.patch(changed.id, changed.revision, {}, inputs.slice(1)), /history/);
  assert.throws(() => service.patch(changed.id, changed.revision, { copy: { title: "Changed", description: "Changed", hashtags: [] } }), /shared content/);
});

test("an agent cannot self-authorize a payload and editing invalidates the owner's grant", async () => {
  const c = providers.saveConnection({ provider: "iphone", name: "Grant" });
  const a = providers.addPhoneAccount(c.id, "instagram", "Grant", "grant");
  const p = await fixture(a.id);
  const { executePublicationCommand: execute } = await import("../server/tools");
  await assert.rejects(execute({ tool: "publication.authorize", id: p.id, revision: p.revision }, { actor: "agent" }), /owner must authorize/);
  await assert.rejects(execute({ tool: "publication.dispatch", id: p.id, revision: p.revision, confirmed: true }, { actor: "agent" }), /owner approval/);
  await execute({ tool: "publication.authorize", id: p.id, revision: p.revision }, { actor: "human" });
  const changed = service.patch(p.id, p.revision, { label: "New revision" });
  await assert.rejects(execute({ tool: "publication.dispatch", id: p.id, revision: changed.revision, confirmed: true }, { actor: "agent" }), /owner approval/);
});

test("provider preflight and serialization share unsupported-option rules", async () => {
  const { routeOptionIssues } = await import("../lib/capabilities");
  const p = model(), options = p.destinations[0].options;
  options.madeForKids = false;
  assert.ok(routeOptionIssues("postbridge", "youtube", options).length);
  options.madeForKids = null; options.useProviderDefaults = true;
  assert.deepEqual(routeOptionIssues("postbridge", "youtube", options), []);
  options.synthetic = true;
  assert.ok(routeOptionIssues("postgun", "youtube", options).some(v => v.includes("synthetic")));
  options.privacy = "unlisted";
  assert.ok(routeOptionIssues("postgun", "tiktok", options).length);
});

test("month calendar covers its complete civil month and navigates without date overflow", async () => {
  const { calendarDates, adjacentPeriod } = await import("../lib/calendar");
  const days = calendarDates("2026-08-31", "month");
  assert.ok(days.includes("2026-08-01")); assert.ok(days.includes("2026-08-31"));
  assert.equal(days.length, 42);
  assert.equal(adjacentPeriod("2026-01-31", "month", 1), "2026-02-01");
  assert.deepEqual(calendarDates("", "week"), []);
});

test("phone verification completes only observed destinations and abort keeps an in-flight device lease", async () => {
  const { randomUUID } = await import("node:crypto");
  const phone = await import("../server/phone/sessions");
  const c = providers.saveConnection({ provider: "iphone", name: "Evidence" });
  const a = providers.addPhoneAccount(c.id, "instagram", "Evidence", "evidence");
  const p = await fixture(a.id), queued = await service.dispatch(p.id, p.revision), d = queued.destinations[0];
  const id = randomUUID(), evidence = randomUUID(), now = Date.now();
  store.put("session", id, { id, publicationId: p.id, destinationIds: [d.id], hashes: { [d.id]: d.payloadHash }, status: "active", step: "Inspect", evidence: [evidence], leaseUntil: now + 300000, createdAt: now, updatedAt: now });
  assert.throws(() => phone.recordPhone({ tool: "publication.phone.record", sessionId: id, destinationId: d.id, outcome: "published", at: null, remoteUrl: null, evidenceId: "not-captured", note: "Missing observed evidence" }), /Capture verification/);
  const result = phone.recordPhone({ tool: "publication.phone.record", sessionId: id, destinationId: d.id, outcome: "published", at: null, remoteUrl: "https://example.test/post", evidenceId: evidence, note: "Simulation: verified native post list" });
  assert.equal(result.session.status, "done"); assert.equal(store.publication(p.id).destinations[0].state, "published");
  const other = await fixture(a.id), next = await service.dispatch(other.id, other.revision), sid = randomUUID();
  store.put("session", sid, { id: sid, publicationId: other.id, destinationIds: [next.destinations[0].id], hashes: { [next.destinations[0].id]: next.destinations[0].payloadHash }, status: "active", step: "Running action", evidence: [], leaseUntil: now + 300000, createdAt: now, updatedAt: now });
  assert.ok(store.claimLease("phone", sid, 300000)); assert.ok(store.claimLease(`phone-action:${sid}`, "action", 120000));
  phone.abortPhone(sid, "Owner stopped during input");
  assert.equal(store.claimLease("phone", "other-session"), false);
  store.releaseLease(`phone-action:${sid}`, "action"); store.releaseLease("phone", sid);
});

test("calendar range includes each destination day and import identity survives moving the backup", async () => {
  const c = providers.saveConnection({ provider: "iphone", name: "Calendar" });
  const a = providers.addPhoneAccount(c.id, "instagram", "Calendar", "calendar");
  const p = await fixture(a.id);
  store.change(p.id, p.revision, current => { current.scheduledAt = "2031-04-10T18:00:00Z"; current.destinations[0].scheduledAt = "2031-04-12T18:00:00Z"; });
  const { calendar } = await import("../server/calendar");
  assert.ok(calendar({ from: "2031-04-12", to: "2031-04-12", accountId: a.id }).publications.some(row => row.id === p.id));
  assert.ok(!calendar({ from: "2031-04-10", to: "2031-04-10", accountId: a.id }).publications.some(row => row.id === p.id));
  const original = path.join(workspace, "cadence-media.json"), copy = path.join(workspace, "moved-cadence.json");
  await fs.writeFile(original, JSON.stringify([{ id: "stable-backup-post", title: "Original", caption: "Original caption", origin: { ref: p.projectId, detail: p.sequenceId }, media: [{ path: source, sha256: await artifacts.fileHash(source) }], destinations: [{ accountId: a.id, network: "instagram", status: "draft" }] }]));
  const importer = await import("../server/import-cadence");
  const result = await importer.applyImport(original, {});
  assert.equal(result.inserted, 1);
  const imported = store.publications().find(p => p.origin === "cadence:stable-backup-post")!;
  assert.ok(imported.artifactId); assert.equal((await artifacts.verifyArtifact(imported.artifactId)).sha256, await artifacts.fileHash(source));
  await fs.copyFile(original, copy); assert.equal((await importer.applyImport(copy, {})).inserted, 0);
  assert.equal(importer.rollbackImport(result.importId).removed, 1);
  assert.ok(!store.publications().some(p => p.id === imported.id));
});

test("API contracts upload, schedule, move and cancel per destination without leaking signed-upload credentials", async () => {
  const requests: Array<{ url: string; method: string; body: Record<string, unknown> }> = [];
  let scheduled = "2035-01-01T12:00:00.000Z", uploadedWithoutKey = false;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    if (String(input) === "https://signed-upload.example.test/video") {
      uploadedWithoutKey = !new Headers(init?.headers).has("authorization");
      return new Response("", { status: 200 });
    }
    return realFetch(input, init);
  };
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const text = Buffer.concat(chunks).toString(); let body = {}; try { body = JSON.parse(text); } catch { /* multipart */ }
    requests.push({ url: req.url!, method: req.method!, body }); res.setHeader("Content-Type", "application/json");
    if (req.method === "DELETE") { res.statusCode = 204; res.end(); return; }
    if (req.url === "/media/upload") { res.end(JSON.stringify({ id: "upload" })); return; }
    if (req.url === "/v1/media/create-upload-url") { res.end(JSON.stringify({ media_id: "upload", upload_url: "https://signed-upload.example.test/video" })); return; }
    if (req.url === "/posts/publish") { res.end(JSON.stringify({ posts: [{ id: "pg-post", integrationId: "123" }] })); return; }
    if (req.url === "/v1/posts" && req.method === "POST") { res.end(JSON.stringify({ id: "pb-post" })); return; }
    if (req.url === "/posts/pg-post/reschedule") { scheduled = (body as { publishDate: string }).publishDate; res.end("{}"); return; }
    if (req.url === "/v1/posts/pb-post" && req.method === "PATCH") scheduled = (body as { scheduled_at: string }).scheduled_at;
    if (req.url === "/posts/pg-post") { res.end(JSON.stringify({ id: "pg-post", state: "SCHEDULED", publishDate: scheduled })); return; }
    if (req.url === "/v1/posts/pb-post") { res.end(JSON.stringify({ id: "pb-post", status: "scheduled", scheduled_at: scheduled })); return; }
    res.statusCode = 404; res.end("{}");
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    for (const provider of ["postgun", "postbridge"] as const) {
      scheduled = "2035-01-01T12:00:00.000Z";
      const c = providers.saveConnection({ provider, name: "Contract fixture", baseUrl, key: "fixture-secret" });
      const a = Account.parse({ id: `${provider}-contract-account`, connectionId: c.id, remoteId: "123", network: "youtube", name: provider }); store.put("account", a.id, a);
      const original = await fixture(a.id);
      const p = store.change(original.id, original.revision, current => { current.scheduledAt = scheduled; if (provider === "postbridge") { current.destinations[0].options.useProviderDefaults = true; current.destinations[0].options.madeForKids = null; } });
      await service.dispatch(p.id, p.revision); await runner.tick("contract-runner");
      const sent = store.publication(p.id); assert.equal(sent.destinations[0].state, "scheduled"); assert.equal(sent.destinations[0].confirmedAt, scheduled);
      const moved = await runner.moveRemote(sent.id, sent.revision, sent.destinations[0].id, "2035-01-02T12:00:00.000Z");
      assert.equal(moved.destinations[0].confirmedAt, "2035-01-02T12:00:00.000Z");
      const cancelled = await runner.cancel(moved.id, moved.revision, moved.destinations[0].id); assert.equal(cancelled.destinations[0].state, "cancelled");
    }
    assert.ok(uploadedWithoutKey);
    const postgun = requests.find(r => r.url === "/posts/publish")!.body;
    assert.equal((postgun.integrations as Array<{ settings: { selfDeclaredMadeForKids: string } }>)[0].settings.selfDeclaredMadeForKids, "no");
    const postbridge = requests.find(r => r.url === "/v1/posts" && r.method === "POST")!.body;
    assert.deepEqual(postbridge.social_accounts, [123]); assert.equal(postbridge.scheduled_at, "2035-01-01T12:00:00.000Z");
    assert.ok(requests.filter(r => r.method === "PATCH").every(r => typeof r.body.scheduled_at === "string"));
  } finally { globalThis.fetch = realFetch; await new Promise<void>(resolve => server.close(() => resolve())); }
});

test("retrying a definite failure clears its old remote identity before a new submission", async () => {
  const c = providers.saveConnection({ provider: "iphone", name: "Retry identity" });
  const a = providers.addPhoneAccount(c.id, "instagram", "Retry", "retry-identity");
  const original = await fixture(a.id), first = await service.dispatch(original.id, original.revision);
  const failed = store.change(first.id, first.revision, p => { const d = p.destinations[0]; d.state = "failed"; d.remoteId = "old-rejected-post"; d.remoteUrl = "https://example.test/old"; });
  const retry = await service.dispatch(failed.id, failed.revision);
  assert.equal(retry.destinations[0].remoteId, null); assert.equal(retry.destinations[0].remoteUrl, null);
  assert.ok(store.documents("delivery-history").some(value => JSON.stringify(value).includes("old-rejected-post")));
});

test("cancel timeout is reconciled from remote absence, and a stale poll cannot resurrect it", async () => {
  const server = createServer((req, res) => { if (req.method === "DELETE") { req.socket.destroy(); return; } res.statusCode = 404; res.end("{}"); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const c = providers.saveConnection({ provider: "postgun", name: "Cancel timeout fixture", baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}`, key: "fixture" });
    const a = Account.parse({ id: "cancel-timeout-account", connectionId: c.id, remoteId: "123", network: "instagram", name: "Cancel timeout" }); store.put("account", a.id, a);
    const original = await fixture(a.id);
    const p = store.change(original.id, original.revision, value => { value.destinations[0].state = "scheduled"; value.destinations[0].remoteId = "deleted-remotely"; });
    const old = structuredClone(p.destinations[0]);
    await assert.rejects(runner.cancel(p.id, p.revision, old.id));
    assert.equal(store.publication(p.id).destinations[0].state, "cancel_pending");
    const verified = await runner.refresh(p.id); assert.equal(verified.destinations[0].state, "cancelled");
    runner.recordResult(p.id, old.id, { state: "scheduled" }, old);
    assert.equal(store.publication(p.id).destinations[0].state, "cancelled");
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

test("phone diagnostics distinguish setup failures without disclosing clipboard or process arguments", async () => {
  const { phoneCommandFailure } = await import("../lib/phone");
  assert.match(phoneCommandFailure({ code: "ENOENT" }), /Build it in Publishing settings/);
  assert.match(phoneCommandFailure({ stderr: "Open iPhone Mirroring\n" }), /Open iPhone Mirroring on this Mac/);
  assert.match(phoneCommandFailure({ stderr: "No visible Mirroring window" }), /onto the screen/);
  assert.match(phoneCommandFailure({ killed: true, stderr: "paste private-caption" }), /may have received the input/);
  assert.ok(!phoneCommandFailure({ message: "Command failed: paste private-caption", stderr: "private-caption" }).includes("private-caption"));
  assert.equal(typeof phoneCommandFailure({ stderr: "toString" }), "string");
});

test("phone readiness rejects malformed geometry before coordinates can become desktop input", async () => {
  const { parsePhoneWindow } = await import("../lib/phone");
  const valid = "id=12 x=-400 y=20 w=350 h=700 frontmost=true trusted=true";
  assert.equal(parsePhoneWindow(valid).x, -400, "a monitor may have negative desktop coordinates");
  assert.equal(parsePhoneWindow(valid.replace("trusted=true", "trusted=false")).trusted, false);
  for (const invalid of [valid.replace("w=350", "w=NaN"), valid.replace("h=700", "h=0"), valid.replace("id=12", "id=-1"), "unrecognized protocol"]) assert.throws(() => parsePhoneWindow(invalid), /invalid window information/);
});
