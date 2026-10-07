import { z } from "zod";
import type { Occupancy } from "../../types";
import * as store from "../store";
import { request } from "./http";

/** Explicit refresh: calendar reads never perform remote actions. All pages must succeed. */
export async function syncOccupancy(connectionId: string) {
  const c = store.connection(connectionId), accounts = store.accounts().filter(a => a.connectionId === c.id);
  if (c.provider === "iphone") throw new Error("Native app schedules must be verified in an attended phone session");
  const occupied: Occupancy[] = [];
  const localRemoteIds = new Set(store.publications().flatMap(p => p.destinations.filter(d => accounts.some(a => a.id === d.accountId)).map(d => d.remoteId)));
  let complete = false;
  for (let page = 0; page < 100; page++) {
    const endpoint = c.provider === "postgun" ? `/posts?state=SCHEDULED,PUBLISHED,PUBLISHING&page=${page + 1}&limit=100` : `/v1/posts?offset=${page * 100}&limit=100`;
    const response = z.object({ data: z.array(z.record(z.string(), z.unknown())) }).parse(await request(c.id, endpoint));
    for (const raw of response.data) {
      const post = c.provider === "postgun"
        ? (() => { const value = z.object({ id: z.string(), integrationId: z.string(), publishDate: z.string().nullable() }).parse(raw); return { id: value.id, ids: [value.integrationId], at: value.publishDate }; })()
        : (() => { const value = z.object({ id: z.string(), status: z.string(), social_accounts: z.array(z.number()), scheduled_at: z.string().nullable() }).parse(raw); return { id: value.id, ids: value.social_accounts.map(String), at: ["scheduled", "posted", "processing"].includes(value.status) ? value.scheduled_at : null }; })();
      if (!post.at || !Number.isFinite(Date.parse(post.at)) || localRemoteIds.has(post.id)) continue;
      for (const a of accounts.filter(a => post.ids.includes(a.remoteId))) occupied.push({ accountId: a.id, at: post.at, publicationId: `external:${c.id}:${post.id}` });
    }
    if (response.data.length < 100) { complete = true; break; }
  }
  if (!complete) throw new Error("The provider calendar exceeds the refresh limit. Its previous snapshot was retained; check it directly before scheduling.");
  const snapshot = { connectionId, checkedAt: Date.now(), occupied };
  store.put("external-calendar", connectionId, snapshot); return snapshot;
}
export function externalOccupancy(): Occupancy[] {
  const owned = new Set(store.publications().flatMap(p => p.destinations.flatMap(d => d.remoteId ? [`external:${store.account(d.accountId).connectionId}:${d.remoteId}`] : [])));
  return store.documents("external-calendar").flatMap(raw => {
    const snapshot = raw as { occupied: Occupancy[] };
    return snapshot.occupied.filter(o => !owned.has(o.publicationId)).map(o => ({ ...o, accountId: store.account(o.accountId).equivalentTo ?? o.accountId }));
  });
}
