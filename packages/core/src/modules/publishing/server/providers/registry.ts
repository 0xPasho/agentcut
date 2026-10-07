import { openAsBlob } from "node:fs";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Connection, ProviderResult, ResolvedPayload } from "../../types";
import { Connection as ConnectionSchema, Network } from "../../types";
import { routeOptionIssues } from "../../lib/capabilities";
import { PROVIDER_URLS } from "../../data";
import { artifactFile, verifyArtifact } from "../artifacts";
import * as store from "../store";
import { DeliveryError, request } from "./http";

export function saveConnection(input: { id?: string; provider: Connection["provider"]; name: string; baseUrl?: string; key?: string }) {
  const id = input.id ?? randomUUID(), previous = store.connections().find(c => c.id === id);
  if (previous && previous.provider !== input.provider) throw new Error("Create a new connection to change provider");
  if (previous && store.accounts().some(a => a.connectionId === id) && input.baseUrl && input.baseUrl !== previous.baseUrl) throw new Error("Create a new connection for a different provider instance");
  const baseUrl = input.baseUrl ?? previous?.baseUrl ?? PROVIDER_URLS[input.provider];
  if (input.provider !== "iphone") { const url = new URL(baseUrl); if (url.username || url.password || (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))) throw new Error("Use HTTPS, or a local HTTP instance without credentials in the URL"); }
  return store.transaction(() => {
    if (input.key !== undefined) store.setSecret(id, input.key.trim());
    const c = ConnectionSchema.parse({ ...previous, id, provider: input.provider, name: input.name, baseUrl, configured: input.provider === "iphone" || !!store.secret(id) });
    store.put("connection", id, c); return c;
  });
}
export function addPhoneAccount(connectionId: string, network: z.infer<typeof Network>, name: string, remoteId: string) {
  if (store.connection(connectionId).provider !== "iphone") throw new Error("Phone accounts belong to an iPhone connection");
  const old = store.accounts().find(a => a.connectionId === connectionId && a.remoteId === remoteId);
  const a = { id: old?.id ?? randomUUID(), connectionId, network, name, remoteId, disabled: false, needsReconnect: false, equivalentTo: old?.equivalentTo ?? null };
  store.put("account", a.id, a); return a;
}
export async function syncAccounts(id: string) {
  const c = store.connection(id); if (c.provider === "iphone") return store.accounts().filter(a => a.connectionId === id);
  const found: Array<{ remoteId: string; network: z.infer<typeof Network>; name: string; disabled: boolean; needsReconnect: boolean }> = [];
  try {
    if (c.provider === "postgun") {
      const rows = z.array(z.object({ id: z.string(), providerIdentifier: z.string(), name: z.string(), disabled: z.boolean().optional(), refreshNeeded: z.boolean().optional() })).parse(await request(id, "/integrations"));
      for (const r of rows) { const network = Network.safeParse(r.providerIdentifier.split("-")[0]); if (network.success) found.push({ remoteId: r.id, network: network.data, name: r.name, disabled: !!r.disabled, needsReconnect: !!r.refreshNeeded }); }
    } else {
      for (let offset = 0; offset < 10000; offset += 100) {
        const page = z.object({ data: z.array(z.object({ id: z.union([z.number(), z.string()]), platform: z.string(), username: z.string(), needs_reconnect: z.boolean().optional() })) }).parse(await request(id, `/v1/social-accounts?offset=${offset}&limit=100`));
        for (const r of page.data) { const network = Network.safeParse(r.platform); if (network.success) found.push({ remoteId: String(r.id), network: network.data, name: r.username, disabled: false, needsReconnect: !!r.needs_reconnect }); }
        if (page.data.length < 100) break;
      }
    }
    store.transaction(() => {
      const previous = store.accounts().filter(a => a.connectionId === id);
      for (const a of previous) if (!found.some(r => r.remoteId === a.remoteId)) store.put("account", a.id, { ...a, disabled: true });
      for (const row of found) { const old = previous.find(a => a.remoteId === row.remoteId); const a = { ...row, id: old?.id ?? randomUUID(), connectionId: id, equivalentTo: old?.equivalentTo ?? null }; store.put("account", a.id, a); }
      store.put("connection", id, { ...c, checkedAt: Date.now(), error: null });
    });
    return store.accounts().filter(a => a.connectionId === id);
  } catch (error) { store.put("connection", id, { ...c, checkedAt: Date.now(), error: (error as Error).message }); throw error; }
}
export function providerOptions(p: ResolvedPayload, provider: Connection["provider"]): Record<string, unknown> {
  const o = p.options;
  const issues = routeOptionIssues(provider, p.network, o);
  if (issues.length) throw new DeliveryError(issues.join("\n"), false);
  if (provider === "postbridge") {
    if (p.network === "youtube") {
      // Explicit acceptance of provider defaults is validated by the shared route contract.
      return { title: p.title, contains_synthetic_media: o.synthetic, tags: o.tags };
    }
    if (p.network === "tiktok") return { privacy_status: o.privacy === "private" ? "private" : "public", is_aigc: o.synthetic, allow_comment: o.comments, allow_duet: o.duet, allow_stitch: o.stitch, disclose_branded_content: o.branded, disclose_your_brand: o.ownBrand };
    return {};
  }
  if (p.network === "youtube") {
    return { title: p.title, type: o.privacy, selfDeclaredMadeForKids: o.madeForKids ? "yes" : "no", tags: o.tags };
  }
  if (p.network === "tiktok") return { privacy_level: o.privacy === "private" ? "SELF_ONLY" : "PUBLIC_TO_EVERYONE", comment: o.comments, duet: o.duet, stitch: o.stitch, video_made_with_ai: o.synthetic, brand_content_toggle: o.branded, brand_organic_toggle: o.ownBrand };
  return {};
}
async function upload(p: ResolvedPayload) {
  const a = await verifyArtifact(p.artifactId), c = store.connection(p.connectionId), cacheId = `${c.id}:${a.sha256}`;
  const cached = store.document("upload", cacheId) as { id: string; expires: number } | null;
  if (cached && cached.expires > Date.now()) return cached.id;
  const blob = await openAsBlob(artifactFile(a.id), { type: "video/mp4" });
  let id: string;
  if (c.provider === "postgun") {
    const body = new FormData(); body.append("file", blob, `${a.id}.mp4`);
    id = z.object({ id: z.string() }).parse(await request(c.id, "/media/upload", "POST", body)).id;
  } else {
    const link = z.object({ media_id: z.string(), upload_url: z.url() }).parse(await request(c.id, "/v1/media/create-upload-url", "POST", { mime_type: "video/mp4", size_bytes: a.bytes, name: `${a.id}.mp4` }));
    if (new URL(link.upload_url).protocol !== "https:") throw new DeliveryError("Provider returned an insecure upload URL", false);
    const res = await fetch(link.upload_url, { method: "PUT", body: blob, headers: { "Content-Type": "video/mp4" }, redirect: "error", signal: AbortSignal.timeout(300_000) });
    if (!res.ok) throw new DeliveryError("Video upload failed. No publication was submitted.", false);
    id = link.media_id;
  }
  store.put("upload", cacheId, { id, expires: Date.now() + 3600_000 }); return id;
}
export async function send(p: ResolvedPayload): Promise<ProviderResult> {
  const c = store.connection(p.connectionId), options = providerOptions(p, c.provider);
  let mediaId: string;
  try { mediaId = await upload(p); } catch (error) { throw new DeliveryError((error as Error).message, false, error instanceof DeliveryError ? error.retryAfter : 0); }
  if (c.provider === "postgun") {
    const response = z.object({ posts: z.array(z.object({ id: z.string(), integrationId: z.string() })) }).parse(await request(c.id, "/posts/publish", "POST", { sourceType: "DIRECT", content: p.caption, mediaIds: [mediaId], ...(p.scheduledAt ? { publishDate: p.scheduledAt } : {}), integrations: [{ integrationId: p.remoteAccountId, caption: p.caption, mediaIds: [mediaId], ...(p.scheduledAt ? { publishDate: p.scheduledAt, scheduleSource: "CUSTOM" } : {}), settings: options }] }));
    const post = response.posts.find(r => r.integrationId === p.remoteAccountId);
    if (!post) throw new DeliveryError("Submission returned no matching post. Reconcile in Postgun before retrying.", true);
    try { return await remoteStatus(c.id, post.id); } catch { return { state: "unknown", remoteId: post.id, error: "Submitted; refresh to confirm its state." }; }
  }
  const post = z.object({ id: z.string() }).parse(await request(c.id, "/v1/posts", "POST", { caption: p.caption, social_accounts: [Number(p.remoteAccountId)], media: [mediaId], is_draft: false, ...(p.scheduledAt ? { scheduled_at: p.scheduledAt } : {}), platform_configurations: { [p.network]: options } }));
  try { return await remoteStatus(c.id, post.id); } catch { return { state: "unknown", remoteId: post.id, error: "Submitted; refresh to confirm its state." }; }
}
export async function remoteStatus(connectionId: string, id: string): Promise<ProviderResult> {
  const c = store.connection(connectionId);
  if (c.provider === "postgun") {
    const row = z.object({ id: z.string(), state: z.string(), releaseURL: z.string().nullish(), publishDate: z.string().nullish(), publishedAt: z.string().nullish(), error: z.string().nullish() }).parse(await request(c.id, `/posts/${encodeURIComponent(id)}`));
    const state: ProviderResult["state"] = ({ SCHEDULED: "scheduled", PUBLISHED: "published", PUBLISHING: "sending", ERROR: "failed" } as const)[row.state as "SCHEDULED" | "PUBLISHED" | "PUBLISHING" | "ERROR"] ?? "unknown";
    return { state, remoteId: row.id, remoteUrl: row.releaseURL, confirmedAt: row.publishDate, publishedAt: row.publishedAt, error: row.error };
  }
  const row = z.object({ id: z.string(), status: z.string(), scheduled_at: z.string().nullish() }).parse(await request(c.id, `/v1/posts/${encodeURIComponent(id)}`));
  const state: ProviderResult["state"] = ({ scheduled: "scheduled", posted: "published", processing: "sending", failed: "failed" } as const)[row.status as "scheduled" | "posted" | "processing" | "failed"] ?? "unknown";
  let remoteUrl: string | null = null;
  if (state === "published") {
    const result = z.object({ data: z.array(z.object({ platform_data: z.record(z.string(), z.unknown()).nullish() })) }).parse(await request(c.id, `/v1/post-results?post_id=${encodeURIComponent(id)}`));
    const url = result.data[0]?.platform_data?.url; if (typeof url === "string") remoteUrl = url;
  }
  return { state, remoteId: id, remoteUrl, confirmedAt: row.scheduled_at, publishedAt: null, error: state === "failed" ? "The provider reported a failed post. Review its details before retrying." : null };
}
export async function cancelRemote(connectionId: string, remoteId: string) { const c = store.connection(connectionId); await request(c.id, `${c.provider === "postgun" ? "/posts/" : "/v1/posts/"}${encodeURIComponent(remoteId)}`, "DELETE"); }
export async function rescheduleRemote(connectionId: string, remoteId: string, at: string) {
  if (!Number.isFinite(Date.parse(at)) || Date.parse(at) <= Date.now()) throw new Error("Choose a future publication time");
  const c = store.connection(connectionId);
  if (c.provider === "postgun") await request(c.id, `/posts/${encodeURIComponent(remoteId)}/reschedule`, "PUT", { publishDate: at });
  else await request(c.id, `/v1/posts/${encodeURIComponent(remoteId)}`, "PATCH", { scheduled_at: at });
  return remoteStatus(c.id, remoteId);
}

export async function connectLink(connectionId: string, network: "instagram" | "tiktok", returnUrl: string) {
  const c = store.connection(connectionId);
  if (c.provider !== "postbridge") throw new Error("Connect this account in the Postgun instance, then refresh accounts here.");
  const result = z.object({ url: z.url(), expires_at: z.string() }).parse(await request(c.id, "/v1/social-accounts/connect-link", "POST", { platform: network, return_url: returnUrl }));
  if (new URL(result.url).protocol !== "https:") throw new Error("The provider returned an insecure connection link");
  return result;
}
