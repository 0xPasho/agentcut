import type { Format, Network, PublicationStatus } from "./types";

export const STATUS_LABELS: Record<PublicationStatus, string> = { draft: "Draft", approved: "Approved", pending: "Pending publication", publishing: "Publishing", scheduled: "Scheduled", published: "Published", partial: "Partially published", attention: "Needs attention", cancelled: "Cancelled" };
export const FORMATS: Record<Format, { network: Network; label: string }> = { "youtube-video": { network: "youtube", label: "YouTube video" }, "youtube-short": { network: "youtube", label: "YouTube Short" }, "instagram-reel": { network: "instagram", label: "Instagram Reel" }, "tiktok-video": { network: "tiktok", label: "TikTok video" } };
export const PROVIDER_URLS = { iphone: "", postgun: "https://api.postgun.ai", postbridge: "https://api.post-bridge.com" };
export const ACTIVE_DELIVERY = ["queued", "sending", "scheduled", "published", "unknown", "cancel_pending"];
export const PHONE_COMMAND_ERRORS: Record<string, string> = {
  "Open iPhone Mirroring": "Open iPhone Mirroring on this Mac, connect the nearby locked iPhone, then check the connection again.",
  "No visible Mirroring window": "Bring the iPhone Mirroring window onto the screen, then check the connection again.",
  "Refused: focus and Accessibility required": "Keep iPhone Mirroring in front and grant Accessibility to the application running Agentcut.",
  "Point outside window": "The Mirroring window changed. Capture a new screen before choosing another position.",
};
export const PHONE_GUIDE = {
  transfer: "Find the exact approved file in Drive, Send a copy → Save Video. Verify the filename, duration, dimensions and visible contents in Photos. Download once for this publication. For an existing Photos item verify identity; newest alone is insufficient.",
  instagram: "Verify the account. Create a Reel; reject restored drafts. Select exactly the approved video, verify the preview, Next through editor. Paste caption once and inspect it. For scheduling, More options → Schedule this reel; inspect the date/time picker and read back its actual value. Before the final Share/Schedule tap, verify account, video, text and time against the approved payload. After submission verify in profile or Scheduled content and capture evidence.",
  tiktok: "Verify the account in TikTok Studio. Upload → select exactly the approved video → Next. Verify it did not restore another draft. Paste description once, wait and inspect. Set approved options and Schedule post if requested. Read back the exact date/time. Submit with Publish/Schedule only after inspecting the approved payload. Verify in Manage after upload completes and capture evidence.",
  youtube: "Verify the channel. Upload video → choose approved video → inspect full-length trim → Next. Caption your Short is the title; Show more → Add description holds the caption and hashtags. Paste once, wait at least three seconds and verify no duplicate text. Set audience and visibility; for scheduling inspect date/time in local phone zone and read it back. Submit Upload Short only after verifying approved payload. Verify Scheduled or live on the channel after upload completes. Never treat uploading as published.",
};
