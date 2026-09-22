import type { VideoTemplate } from "./schema";
import { resolveTemplate } from "./resolve";
import { ASPECTS } from "../editor/derive";

/**
 * A schematic of a template's layout, as SVG: where the hook sits, the caption band
 * and its colours, the picture plate, the watermark corner, the cards. Not a render —
 * a render needs footage and minutes — but enough to choose by looking, cached by
 * nobody because it is cheap.
 */
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c] ?? c));

export function templatePreviewSvg(template: VideoTemplate, aspect = "9:16"): string {
  const t = resolveTemplate(template, { aspect });
  const frame = ASPECTS[aspect] ?? ASPECTS["9:16"];
  const H = 360, W = Math.round((H * frame.width) / frame.height);
  const captions = t.captions as Partial<{ positionY: number; color: string; highlight: string; uppercase: boolean; fontSizePct: number; maxWordsPerLine: number }>;
  const bg = t.brand.palette.background || "#15151a";
  const accent = captions.highlight ?? t.brand.palette.primary ?? "#ffe600";
  const text = captions.color ?? "#ffffff";
  const fontPct = captions.fontSizePct ?? 5.5;
  const fontPx = Math.max(8, (H * fontPct) / 100);
  const y = (captions.positionY ?? 0.72) * H;
  const parts: string[] = [];
  parts.push(`<rect width="${W}" height="${H}" rx="14" fill="${esc(bg)}"/>`);
  // Where the speaker is drawn is the layout: in the middle of an ordinary frame, in
  // their own half of a split. A schematic that puts them in the middle of a split is
  // showing the thing the split exists to avoid.
  const split = t.layout.mode === "split";
  const seam = split ? ((t.layout.cameraPosition === "top" ? t.layout.cameraPct : 100 - t.layout.cameraPct) / 100) * H : 0;
  const cameraTop = split ? (t.layout.cameraPosition === "top" ? 0 : seam) : 0;
  const cameraHeight = split ? (t.layout.cameraPosition === "top" ? seam : H - seam) : H;
  if (split) {
    const screenTop = t.layout.cameraPosition === "top" ? seam : 0;
    const screenHeight = H - cameraHeight;
    parts.push(`<rect x="0" y="${screenTop}" width="${W}" height="${screenHeight}" fill="#1e1e28"/>`);
    // A window on the screen half, so it reads as a shared screen rather than a gap.
    parts.push(`<rect x="${W * 0.08}" y="${screenTop + screenHeight * 0.14}" width="${W * 0.84}" height="${screenHeight * 0.66}" rx="6" fill="#26262f" stroke="#3a3a44" stroke-width="2"/>`);
    for (const i of [0, 1, 2]) parts.push(`<rect x="${W * 0.12}" y="${screenTop + screenHeight * (0.26 + i * 0.13)}" width="${W * (0.6 - i * 0.13)}" height="${Math.max(2, screenHeight * 0.035)}" rx="2" fill="#3f3f4b"/>`);
    parts.push(`<line x1="0" y1="${seam}" x2="${W}" y2="${seam}" stroke="#000" stroke-width="2" opacity="0.8"/>`);
  }
  const faceY = cameraTop + cameraHeight * (split ? 0.42 : 0.42);
  parts.push(`<circle cx="${W / 2}" cy="${faceY}" r="${Math.min(H * 0.07, cameraHeight * 0.22)}" fill="#3a3a44"/><rect x="${W / 2 - H * 0.11}" y="${faceY + Math.min(H * 0.07, cameraHeight * 0.22)}" width="${H * 0.22}" height="${Math.min(H * 0.2, cameraHeight * 0.45)}" rx="${H * 0.05}" fill="#33333c"/>`);
  if (t.hook.mode !== "off") {
    const hy = t.hook.position === "top" ? H * 0.08 : t.hook.position === "center" ? H * 0.46 : H * 0.84;
    parts.push(t.hook.style === "card"
      ? `<rect x="${W * 0.12}" y="${hy}" width="${W * 0.76}" height="${H * 0.08}" rx="8" fill="#ffffff"/><text x="${W / 2}" y="${hy + H * 0.055}" font-size="${H * 0.04}" font-weight="800" text-anchor="middle" fill="#111" font-family="Inter, sans-serif">HOOK</text>`
      : `<text x="${W / 2}" y="${hy + H * 0.055}" font-size="${H * 0.045}" font-weight="900" text-anchor="middle" fill="${esc(text)}" font-family="Inter, sans-serif">HOOK</text>`);
  }
  if (t.images.mode !== "off") {
    const iy = t.images.y * H, iw = (t.images.widthPct / 100) * W, ih = iw * 0.62;
    parts.push(`<rect x="${W / 2 - iw / 2}" y="${iy - ih / 2}" width="${iw}" height="${ih}" rx="8" fill="#e8e8ec" stroke="#ffffff" stroke-width="3"/><text x="${W / 2}" y="${iy + 4}" font-size="${H * 0.03}" text-anchor="middle" fill="#666" font-family="Inter, sans-serif">picture</text>`);
  }
  if ((captions.maxWordsPerLine ?? 3) > 0 && (t.captions as { preset?: string }).preset !== "none") {
    const words = (captions.uppercase ? ["THIS", "IS", "HOW"] : ["this", "is", "how"]).slice(0, Math.min(3, captions.maxWordsPerLine ?? 3));
    let x = W / 2 - (words.length * fontPx * 1.6) / 2;
    for (const [i, word] of words.entries()) {
      parts.push(`<text x="${x}" y="${y + fontPx}" font-size="${fontPx}" font-weight="900" fill="${esc(i === 1 ? accent : text)}" stroke="#000" stroke-width="${Math.max(1, fontPx / 12)}" paint-order="stroke" font-family="${esc((captions as { fontFamily?: string }).fontFamily ?? "Inter")}, sans-serif">${esc(word)}</text>`);
      x += fontPx * 1.6;
    }
  }
  if (t.watermark.enabled) {
    const size = (t.watermark.widthPct / 100) * W, m = (t.watermark.marginPct / 100) * W;
    const wx = t.watermark.corner.endsWith("left") ? m : W - m - size, wy = t.watermark.corner.startsWith("top") ? m : H - m - size;
    parts.push(`<rect x="${wx}" y="${wy}" width="${size}" height="${size}" rx="6" fill="#ffffff" opacity="${t.watermark.opacity}"/>`);
  }
  for (const card of t.cards) {
    const cy = card.position === "top" ? H * 0.2 : card.position === "center" ? H * 0.58 : H * 0.9;
    parts.push(`<rect x="${W * 0.2}" y="${cy}" width="${W * 0.6}" height="${H * 0.06}" rx="6" fill="#ffffff" opacity="0.55"/>`);
  }
  if (t.intro.enabled) parts.push(`<rect x="6" y="6" width="${W * 0.18}" height="${H * 0.05}" rx="4" fill="${esc(accent)}"/><text x="${6 + W * 0.09}" y="${6 + H * 0.037}" font-size="${H * 0.028}" text-anchor="middle" fill="#111" font-family="Inter, sans-serif">intro</text>`);
  if (t.outro.enabled) parts.push(`<rect x="${W - 6 - W * 0.18}" y="6" width="${W * 0.18}" height="${H * 0.05}" rx="4" fill="${esc(accent)}"/><text x="${W - 6 - W * 0.09}" y="${6 + H * 0.037}" font-size="${H * 0.028}" text-anchor="middle" fill="#111" font-family="Inter, sans-serif">outro</text>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(t.name)} layout, ${esc(aspect)}">${parts.join("")}</svg>`;
}
