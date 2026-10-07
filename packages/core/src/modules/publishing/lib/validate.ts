import { FORMATS } from "../data";
import type { Account, Artifact, Connection, Publication, ValidationIssue } from "../types";
import { routeOptionIssues } from "./capabilities";
import { caption, intendedTime, resolveCopy } from "./resolve";

export function validatePublication(p: Publication, accounts: Account[], connections: Connection[], artifact: Artifact | null, approved: boolean, now = Date.now()): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (destinationId: string | null, field: string, message: string) => issues.push({ destinationId, field, message });
  if (!approved) add(null, "approval", "Approve this video in the editor or video list before publishing.");
  if (!artifact) add(null, "artifact", "Render and pin the video to publish.");
  if (!p.destinations.length) add(null, "accounts", "Choose at least one account.");
  try { new Intl.DateTimeFormat("en", { timeZone: p.timezone }); } catch { add(null, "timezone", "Choose a valid IANA timezone."); }
  const seen = new Set<string>();
  for (const d of p.destinations) {
    if (d.state === "cancelled") continue;
    const a = accounts.find(a => a.id === d.accountId), c = connections.find(c => c.id === a?.connectionId);
    if (!a || !c) { add(d.id, "account", "Reconnect or choose an available account."); continue; }
    const identity = a.equivalentTo ?? a.id;
    if (seen.has(identity)) add(d.id, "account", "The same account is selected through two routes. Choose one route.");
    seen.add(identity);
    if (!["not_sent", "failed"].includes(d.state)) continue;
    if (a.disabled || a.needsReconnect || !c.configured) add(d.id, "account", "This account needs to be connected before sending.");
    if (FORMATS[d.format].network !== a.network) add(d.id, "format", "The format does not match this account.");
    const copy = resolveCopy(p.copy, d);
    if (!copy.description.trim()) add(d.id, "description", "Write a description for this destination.");
    if (a.network === "youtube" && (!copy.title.trim() || [...copy.title].length > 100)) add(d.id, "title", "YouTube needs a title of 1–100 characters.");
    if (a.network === "youtube" && d.options.madeForKids === null && !(c.provider === "postbridge" && d.options.useProviderDefaults)) add(d.id, "audience", "Choose whether this YouTube video is made for kids.");
    for (const message of routeOptionIssues(c.provider, a.network, d.options)) add(d.id, "options", message);
    if (a.network === "youtube" && d.options.tags.reduce((n, tag) => n + tag.length + (tag.includes(" ") ? 2 : 0) + 1, 0) > 500) add(d.id, "tags", "Keep YouTube metadata tags within 500 characters; otherwise the provider can discard them.");
    if (artifact && d.format === "youtube-short" && artifact.duration > 180) add(d.id, "video", "YouTube Shorts must be at most three minutes. Choose a full-video format or shorten the export.");
    if (artifact && d.format === "youtube-video" && artifact.height >= artifact.width && artifact.duration <= 180) add(d.id, "format", "YouTube classifies square or vertical uploads up to three minutes as Shorts. Choose Shorts for this export.");
    const max = { youtube: 5000, instagram: 2200, tiktok: 2200 }[a.network];
    if ([...caption(copy)].length > max) add(d.id, "description", `The composed description exceeds the supported ${max}-character limit.`);
    const at = intendedTime(p, d);
    if (at && (!Number.isFinite(Date.parse(at)) || Date.parse(at) <= now)) add(d.id, "time", "Choose a future time or explicitly publish now.");
    if (p.expiresAt && (!at || Date.parse(at) >= Date.parse(p.expiresAt)) && Date.parse(p.expiresAt) <= (at ? Date.parse(at) : now)) add(d.id, "expiry", "This content expires before its intended publication.");
    if (c.provider === "iphone") {
      if (!p.phoneSource || p.phoneSource.artifactId !== p.artifactId) add(d.id, "source", "Identify the phone/Drive copy of this pinned export.");
      if (d.format === "youtube-video") add(d.id, "format", "The verified phone flow supports Shorts. Choose an API route for a full YouTube video.");
      if (at && a.network === "instagram" && new Date(at).getUTCMinutes() % 5 !== 0) add(d.id, "time", "The Instagram phone picker needs a five-minute boundary. Choose an exact supported time.");
    }
    if (artifact && d.format !== "youtube-video" && artifact.height < artifact.width) add(d.id, "video", "Choose a portrait or square export for this short-video format.");
  }
  return issues;
}
