import React from "react";
import { Img } from "remotion";
import { loadFont } from "@remotion/google-fonts/Inter";
import { emWidth } from "../src/lib/text-fit";

const { fontFamily: inter } = loadFont("normal", { weights: ["600", "700", "800"], subsets: ["latin"] });

/**
 * A viewer's comment, drawn as the still a stream short opens on.
 *
 * It is rendered once, to a transparent picture, and placed on the video like any other
 * image: the editor and the agent can then move it, resize it, retime it or delete it
 * with the tools they already have, and the export draws exactly what the preview does.
 * The look is the chat the comment came from — avatar with the platform's mark on it,
 * the name, the words — on the white card the hook uses, so the two read as one voice.
 */

export type CommentCardProps = {
  platform: "tiktok" | "twitch" | "youtube" | "kick";
  name: string;
  text: string;
  /** A data URL, so the render never depends on a CDN link that expires. Empty draws initials. */
  avatar: string;
};

const PLATFORM: Record<CommentCardProps["platform"], { label: string; color: string; fg: string; glyph: number; path: string }> = {
  tiktok: { label: "TikTok", color: "#06B6D4", fg: "#04222b", glyph: 0.84,
    path: "M16.6 5.82A4.28 4.28 0 0 1 15.54 3h-3.09v12.4a2.59 2.59 0 0 1-2.59 2.5 2.59 2.59 0 1 1 .77-5.06v-3.1a5.66 5.66 0 0 0-.77-.05A5.66 5.66 0 1 0 15.52 15V8.99a7.35 7.35 0 0 0 4.3 1.38V7.28a4.28 4.28 0 0 1-3.22-1.46Z" },
  twitch: { label: "Twitch", color: "#9146FF", fg: "#ffffff", glyph: 0.76,
    path: "M4.3 3 3 6.5v12h4v2.5h2.5l2.5-2.5h3.6L21 13V3H4.3Zm14.7 9.2-2.6 2.6h-3.9l-2.3 2.3v-2.3H7V4.7h12v7.5ZM16.4 7v4.3h-1.7V7h1.7Zm-4.6 0v4.3h-1.7V7h1.7Z" },
  youtube: { label: "YouTube", color: "#FF0033", fg: "#ffffff", glyph: 0.88,
    path: "M21.6 7.2a2.5 2.5 0 0 0-1.77-1.78C18.25 5 12 5 12 5s-6.25 0-7.83.42A2.5 2.5 0 0 0 2.4 7.2 26 26 0 0 0 2 12a26 26 0 0 0 .4 4.8 2.5 2.5 0 0 0 1.77 1.78C5.75 19 12 19 12 19s6.25 0 7.83-.42a2.5 2.5 0 0 0 1.77-1.78A26 26 0 0 0 22 12a26 26 0 0 0-.4-4.8ZM10 15.2V8.8l5.2 3.2-5.2 3.2Z" },
  kick: { label: "Kick", color: "#53FC18", fg: "#0a1f04", glyph: 0.68,
    path: "M3 3h5.6v4.2h2.1V5.1h2.1V3h5.6v6.3h-2.1v2.1h-2.1v2.1h2.1v2.1h2.1V21h-5.6v-2.1h-2.1v-2.1H8.6V21H3V3Z" },
};

/** The card's geometry, shared with `calculateMetadata` so the picture is exactly as tall as the card. */
export const CARD = {
  width: 1000,
  margin: 28,
  padding: 40,
  avatar: 96,
  gap: 22,
  nameSize: 34,
  textSize: 50,
  lineHeight: 1.22,
  maxRows: 5,
};

/** How many rows the comment wraps to at the card's width, estimated the way captions are. */
export function commentRows(text: string): number {
  const room = (CARD.width - CARD.margin * 2 - CARD.padding * 2) / CARD.textSize;
  let rows = 1;
  let used = 0;
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const width = emWidth(word);
    if (used > 0 && used + 0.28 + width > room * 0.95) { rows += 1; used = width; }
    else used += (used > 0 ? 0.28 : 0) + width;
  }
  return Math.min(rows, CARD.maxRows);
}

export const commentCardHeight = (text: string) =>
  Math.ceil(CARD.margin * 2 + CARD.padding * 2 + CARD.avatar + CARD.gap + commentRows(text) * CARD.textSize * CARD.lineHeight);

const initials = (name: string) => name.replace(/[^\p{L}\p{N}]/gu, "").slice(0, 2).toUpperCase() || "?";

export const CommentCard: React.FC<CommentCardProps> = ({ platform, name, text, avatar }) => {
  const meta = PLATFORM[platform] ?? PLATFORM.tiktok;
  const chip = Math.round(CARD.avatar * 0.42);
  return (
    <div style={{ position: "absolute", inset: 0, padding: CARD.margin, fontFamily: inter }}>
      <div style={{
        background: "#ffffff", borderRadius: 40, padding: CARD.padding,
        boxShadow: "0 10px 28px rgba(0,0,0,0.35)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 24, height: CARD.avatar }}>
          <div style={{ position: "relative", width: CARD.avatar, height: CARD.avatar, flexShrink: 0 }}>
            {avatar
              ? <Img src={avatar} style={{ width: "100%", height: "100%", borderRadius: "50%", objectFit: "cover" }} />
              : <div style={{ width: "100%", height: "100%", borderRadius: "50%", background: meta.color, color: meta.fg,
                  display: "grid", placeItems: "center", fontSize: 36, fontWeight: 800 }}>{initials(name)}</div>}
            <div style={{
              position: "absolute", right: -6, bottom: -6, width: chip, height: chip, borderRadius: "50%",
              background: meta.color, border: "4px solid #ffffff", display: "grid", placeItems: "center",
            }}>
              <svg viewBox="0 0 24 24" width={chip * meta.glyph * 0.8} height={chip * meta.glyph * 0.8} fill={meta.fg}><path d={meta.path} /></svg>
            </div>
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: CARD.nameSize, fontWeight: 700, color: "#111111", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{name}</div>
            <div style={{ fontSize: 26, fontWeight: 600, color: "#6b7280", marginTop: 2 }}>en {meta.label}</div>
          </div>
        </div>
        <div style={{
          marginTop: CARD.gap, fontSize: CARD.textSize, fontWeight: 800, lineHeight: CARD.lineHeight, color: "#0a0a0a",
          display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: CARD.maxRows, overflow: "hidden",
          overflowWrap: "anywhere",
        }}>{text}</div>
      </div>
    </div>
  );
};
