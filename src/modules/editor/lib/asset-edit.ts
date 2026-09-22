import type { Edit } from "../types";
/** Shared defaults; the resulting edit is validated by the shared operation engine. */
export function assetEdit(asset: { id: string; kind: string; attribution?: string | null }, at: number, duration: number, mode: "music" | "sfx" = "music"): Edit {
  const d = Math.max(0.01, duration-at);
  if (asset.kind === "image") return { type: "image", t: at, d: Math.min(3,d), src: asset.id, query: "", credit: asset.attribution ?? "", y: 0.5, x: null, widthPct: 78, heightPct: 100, style: "card", caption: "", by: "" };
  if (asset.kind === "audio") return mode === "sfx" ? { type: "sfx", t: at, d: Math.min(2,d), src: asset.id, gain: 0.8, by: "" } : { type: "music", t: at, d, src: asset.id, gain: 0.28, duck: true, loop: true, by: "" };
  throw new Error("Choose an image or audio asset");
}
