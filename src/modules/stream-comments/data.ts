export const PLATFORMS: Record<string, string> = { tiktok: "TikTok", twitch: "Twitch", youtube: "YouTube", kick: "Kick" };

/** How a comment enters the video. The same two the template's `comment.style` names. */
export const STYLES: Array<{ value: "open" | "pop"; label: string; note: string }> = [
  { value: "pop", label: "Pops in over it", note: "The hook first, then the message over a blurred frame while you read it out." },
  { value: "open", label: "Opens the video", note: "The message first; the hook comes in as it goes." },
];
