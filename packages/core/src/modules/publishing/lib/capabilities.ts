import type { DestinationOptions, Network, ProviderId } from "../types";

/** The serializer and preflight use the same route contract. Never silently drop a selection. */
export function routeOptionIssues(provider: ProviderId, network: Network, options: DestinationOptions): string[] {
  const issues: string[] = [];
  if (network !== "youtube" && options.privacy === "unlisted") issues.push("Unlisted visibility is only supported for YouTube.");
  if (network !== "youtube" && options.tags.length) issues.push("Metadata tags are only supported for YouTube; use hashtags in the description.");
  if (provider === "iphone") {
    if (network === "youtube" && options.tags.length) issues.push("The YouTube phone flow does not expose metadata tags. Use an API route for tags.");
    return issues;
  }
  if (network === "youtube") {
    if (provider === "postbridge" && (!options.useProviderDefaults || options.madeForKids !== null || options.privacy !== "public")) issues.push("Postbridge cannot set YouTube audience or visibility. Explicitly accept the settings configured in Postbridge, or choose Postgun/iPhone.");
    if (provider === "postgun" && options.synthetic) issues.push("This Postgun contract cannot apply YouTube synthetic-media disclosure. Choose a supported route.");
    if (options.branded || options.ownBrand || !options.comments || options.duet || options.stitch) issues.push("This YouTube API route cannot apply the selected interaction or partnership options.");
  }
  if (network === "instagram" && (options.privacy !== "public" || options.branded || options.ownBrand || options.synthetic || !options.comments || options.duet || options.stitch)) issues.push("This Instagram API route cannot apply the selected visibility, disclosure or interaction settings. Use the phone.");
  return issues;
}
