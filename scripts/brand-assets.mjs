/**
 * The agentcut mark, and every asset derived from it. One geometry, written once
 * here: the marks in `public/brand/`, the tab icon and the touch icon that Next
 * picks up from `src/app/`. Run `node scripts/brand-assets.mjs` after changing a
 * number below; the files it writes are committed. See BRAND.md for what each
 * asset is for and when to use which.
 *
 * The PNGs need a Chromium to rasterise the SVG. The script finds one on the
 * machine; if it can't, it writes every SVG and tells you which PNGs it skipped.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const num = (v) => Number(v.toFixed(2));

/* ─── Geometry ──────────────────────────────────────────────────────────────
   Drawn on a 100×100 grid. Two finger rings — which are also the eyes — and one
   blade that gets mirrored, crossing over the pivot. The rings are what make it
   read as scissors rather than as a face with ears, so they carry most of the
   mass; shrink them and the whole joke collapses. */

/** A curved edge between two points, bellied out by `off` on the normal. */
const edge = (a, b, off) => {
  const dx = b[0] - a[0], dy = b[1] - a[1], m = Math.hypot(dx, dy) || 1;
  const nx = (dy / m) * off, ny = (-dx / m) * off;
  return `C${num(a[0] + dx / 3 + nx)} ${num(a[1] + dy / 3 + ny)} ${num(a[0] + dx * 2 / 3 + nx)} ${num(a[1] + dy * 2 / 3 + ny)} ${num(b[0])} ${num(b[1])}`;
};

const blade = (p) => {
  const tip = [p.tipX, p.tipY], outer = [50 + p.baseOut, 44], inner = [50 - p.baseIn, 55];
  return `M${tip[0]} ${tip[1]}${edge(tip, outer, p.curveOut)}L${num(inner[0])} ${num(inner[1])}${edge(inner, tip, 0)}Z`;
};

/**
 * `full` is the mark proper. `compact` is the same character with fatter blades
 * and a shorter reach, because below about 32px the full one's tips evaporate —
 * measured, not guessed. Anything at or under 32px uses compact.
 */
const GEOM = {
  full: { tipX: 13, tipY: 9, baseOut: 8.5, baseIn: 12, curveOut: 4.6, sep: 18, ringY: 72,
    ringR: 21, eyeRx: 9.4, eyeRy: 12.4, eyeDy: -2.6, screwR: 3.6, tilt: -4, scale: 0.86, glint: true },
  compact: { tipX: 17, tipY: 13, baseOut: 10.5, baseIn: 14, curveOut: 4, sep: 17.5, ringY: 70,
    ringR: 22, eyeRx: 8.6, eyeRy: 10.4, eyeDy: -1.2, screwR: 4, tilt: 0, scale: 0.94, glint: false },
};

const mass = (p) => {
  const b = blade(p);
  return `<g transform="rotate(${p.tilt} 50 50)"><circle cx="${50 - p.sep}" cy="${p.ringY}" r="${p.ringR}"/>` +
    `<circle cx="${50 + p.sep}" cy="${p.ringY}" r="${p.ringR}"/><path d="${b}"/>` +
    `<g transform="translate(100 0) scale(-1 1)"><path d="${b}"/></g></g>`;
};
const eyeAt = (p, side) => [50 + side * p.sep, p.ringY + p.eyeDy];
const holes = (p) => `<g transform="rotate(${p.tilt} 50 50)">` +
  [-1, 1].map((s) => `<ellipse cx="${num(eyeAt(p, s)[0])}" cy="${num(eyeAt(p, s)[1])}" rx="${p.eyeRx}" ry="${p.eyeRy}"/>`).join("") +
  `<circle cx="50" cy="49.5" r="${p.screwR}"/></g>`;
const glints = (p) => !p.glint ? "" : `<g transform="rotate(${p.tilt} 50 50)">` +
  [-1, 1].map((s) => {
    const [cx, cy] = eyeAt(p, s);
    return `<circle cx="${num(cx + p.eyeRx * 0.36)}" cy="${num(cy - p.eyeRy * 0.46)}" r="${num(p.eyeRx * 0.25)}"/>`;
  }).join("") + `</g>`;

const fit = (p, inner) => `<g transform="translate(50 51) scale(${p.scale}) translate(-50 -50)">${inner}</g>`;
const svg = (body, extra = "") =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none"${extra}>${body}</svg>\n`;

/* ─── Flat mark ─────────────────────────────────────────────────────────────
   Holes have to be真 transparent so the mark sits on any background, and the
   rings, blades and eyes overlap each other — so neither fill rule can punch
   them cleanly. A mask can: white where there is metal, black where there is a
   hole. `currentColor` still applies, because what the mask reveals is a plain
   rect painted with it. The React component passes its own `useId()` so several
   copies on one page keep distinct ids. */

const flat = (p, id = "agentcut-mark") => `<mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100">` +
  `<g fill="#fff">${fit(p, mass(p))}</g><g fill="#000">${fit(p, holes(p))}</g>` +
  (p.glint ? `<g fill="#fff">${fit(p, glints(p))}</g>` : "") +
  `</mask><rect width="100" height="100" fill="currentColor" mask="url(#${id})"/>`;

/* ─── The app icon ──────────────────────────────────────────────────────────
   macOS Tahoe's material: the tile has its own bevel, and the glyph floats on it
   in frosted glass — light from the top left, shadow inside the bottom right,
   and its own shadow cast onto the tile. The eyes are real holes, so the bevel
   runs round them too. */

const GRAFITO = {
  tile0: "#2b2b30", tile1: "#0e0e10",
  glyph0: "#ffffff", glyph1: "#eceef4", glyph2: "#c2c6d2",
  glint: "#2b2b30", shadow: 0.5, innerDark: 0.3, sheen: 0.3,
};

const icon3d = (p, t = GRAFITO, q = "") => {
  const body = fit(p, mass(p)), cut = fit(p, holes(p)), spark = fit(p, glints(p));
  return svg(`<defs>
    <clipPath id="${q}sq"><rect width="100" height="100" rx="22.5"/></clipPath>
    <linearGradient id="${q}tile" x1="0" y1="0" x2="0" y2="100" gradientUnits="userSpaceOnUse">
      <stop stop-color="${t.tile0}"/><stop offset="1" stop-color="${t.tile1}"/></linearGradient>
    <radialGradient id="${q}tl" cx="26" cy="12" r="78" gradientUnits="userSpaceOnUse">
      <stop stop-color="#fff" stop-opacity=".22"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
    <linearGradient id="${q}rim" x1="0" y1="0" x2="0" y2="100" gradientUnits="userSpaceOnUse">
      <stop stop-color="#fff" stop-opacity=".5"/><stop offset=".5" stop-color="#fff" stop-opacity=".06"/>
      <stop offset="1" stop-color="#fff" stop-opacity=".22"/></linearGradient>
    <linearGradient id="${q}gl" x1="20" y1="8" x2="78" y2="94" gradientUnits="userSpaceOnUse">
      <stop stop-color="${t.glyph0}"/><stop offset=".58" stop-color="${t.glyph1}"/>
      <stop offset="1" stop-color="${t.glyph2}"/></linearGradient>
    <linearGradient id="${q}sheen" x1="0" y1="0" x2="0" y2="56" gradientUnits="userSpaceOnUse">
      <stop stop-color="#fff" stop-opacity=".55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
    <mask id="${q}shape"><g fill="#fff">${body}</g><g fill="#000">${cut}</g></mask>
    <mask id="${q}inv"><rect width="100" height="100" fill="#fff"/><g fill="#000">${body}</g><g fill="#fff">${cut}</g></mask>
    <filter id="${q}soft" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="2.4"/></filter>
    <filter id="${q}tight" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="1.7"/></filter>
    <filter id="${q}cast" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="3"/></filter>
  </defs>
  <g clip-path="url(#${q}sq)">
    <rect width="100" height="100" fill="url(#${q}tile)"/><rect width="100" height="100" fill="url(#${q}tl)"/>
    <g opacity="${t.shadow}" filter="url(#${q}cast)" transform="translate(0 3)">
      <g mask="url(#${q}shape)"><rect width="100" height="100" fill="#000"/></g></g>
    <g mask="url(#${q}shape)">
      <rect width="100" height="100" fill="url(#${q}gl)"/>
      <g transform="translate(1.4 2.2)" filter="url(#${q}soft)" opacity="${t.innerDark}">
        <rect width="100" height="100" fill="#000" mask="url(#${q}inv)"/></g>
      <g transform="translate(-1.2 -1.8)" filter="url(#${q}tight)" opacity=".95">
        <rect width="100" height="100" fill="#fff" mask="url(#${q}inv)"/></g>
      <rect width="100" height="100" fill="url(#${q}sheen)" opacity="${t.sheen}"/>
    </g>
    <g fill="${t.glint}" opacity=".9">${spark}</g>
    <rect x=".6" y=".6" width="98.8" height="98.8" rx="22" fill="none" stroke="url(#${q}rim)" stroke-width="1.2"/>
  </g>`);
};

/** Two flat inks on the tile — for print, stickers, and anywhere effects don't survive. */
const iconFlat = (p, ink = "#f2efe9", bg = "#141416") => svg(
  `<rect width="100" height="100" rx="22.5" fill="${bg}"/>` +
  `<g fill="${ink}">${fit(p, mass(p))}</g><g fill="${bg}">${fit(p, holes(p))}</g>` +
  (p.glint ? `<g fill="${ink}" opacity=".9">${fit(p, glints(p))}</g>` : ""));

/* ─── The React component ───────────────────────────────────────────────────
   Emitted from the same geometry rather than hand-copied, so there is exactly one
   place where the mark is drawn. The markup is already valid JSX — every attribute
   used here is one React spells the same way. */

/** The flat mark as JSX, with the mask id left as a `{id}` binding. */
const flatJsx = (p) => `    <mask id={id} maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100">
      <g fill="#fff">${fit(p, mass(p))}</g>
      <g fill="#000">${fit(p, holes(p))}</g>${p.glint ? `
      <g fill="#fff">${fit(p, glints(p))}</g>` : ""}
    </mask>
    <rect width="100" height="100" fill="currentColor" mask={\`url(#\${id})\`} />`;

/** SVG spellings React doesn't take. Everything else it accepts verbatim. */
const JSX_ATTRS = {
  "stop-color": "stopColor", "stop-opacity": "stopOpacity", "clip-path": "clipPath",
  "stroke-width": "strokeWidth", "fill-rule": "fillRule", "clip-rule": "clipRule",
  "fill-opacity": "fillOpacity",
};

/** Turns the generated markup into JSX, binding every id to the component's `id`. */
const toJsx = (markup) => {
  let out = markup;
  for (const [svg, jsx] of Object.entries(JSX_ATTRS)) out = out.split(`${svg}="`).join(`${jsx}="`);
  return out
    .replace(/id="@@([a-z]+)"/g, (_, k) => `id={\`\${id}${k}\`}`)
    .replace(/([a-zA-Z-]+)="url\(#@@([a-z]+)\)"/g, (_, attr, k) => `${attr}={\`url(#\${id}${k})\`}`);
};

/** The icon as a component body: the app icon itself, not a tintable glyph. */
const iconJsx = () => toJsx(
  icon3d(GEOM.compact, GRAFITO, "@@")
    .replace(/^<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "").trim());

const component = () => `import { useId, type ReactNode, type SVGProps } from "react";

/**
 * The agentcut mark. Generated by \`node scripts/brand-assets.mjs\` — change the
 * geometry there, not here, or the next run will overwrite you.
 *
 * The rings, the blades and the eyes all overlap, so neither fill rule punches the
 * holes cleanly; a mask does, and \`currentColor\` survives because what the mask
 * reveals is a rect painted with it. The id comes from \`useId\` so two marks on one
 * page can't collide — with the colons stripped, since \`url(#:r0:)\` is not a
 * selector any browser will resolve.
 *
 * Reach for \`AgentcutMark\` in the UI: its blades are thickened for the sizes the
 * interface actually renders at. \`AgentcutMarkLarge\` is the full drawing — sharper
 * tips, a slight tilt, a glint in each eye — and wants 48px or more.
 */
type MarkProps = SVGProps<SVGSVGElement>;

const mark = (body: (id: string) => ReactNode) =>
  function Mark({ className = "size-6", ...props }: MarkProps) {
    const id = \`m\${useId().replace(/:/g, "")}\`;
    return (
      <svg viewBox="0 0 100 100" fill="none" aria-hidden focusable="false" className={className} {...props}>
        {body(id)}
      </svg>
    );
  };

export const AgentcutMark = mark((id) => (
  <>
${flatJsx(GEOM.compact)}
  </>
));

export const AgentcutMarkLarge = mark((id) => (
  <>
${flatJsx(GEOM.full)}
  </>
));

/**
 * The app icon itself — the graphite tile with the glyph floating on it in frosted
 * glass. Fixed colour on purpose: it is a made object, not a tintable glyph, so it
 * ignores \`currentColor\` and the theme. Use it where the product introduces itself
 * — the header, a splash, an about box — and \`AgentcutMark\` everywhere else.
 *
 * It does not break the never-glass-on-glass rule inside a \`<Glass>\` bar: the tile
 * is opaque, so it sits on the material rather than stacking another sheet of it.
 */
export function AgentcutIcon({ className = "size-7", ...props }: MarkProps) {
  const id = \`i\${useId().replace(/:/g, "")}\`;
  return (
    <svg viewBox="0 0 100 100" fill="none" aria-hidden focusable="false" className={className} {...props}>
      ${iconJsx()}
    </svg>
  );
}
`;

/* ─── Rasterising ───────────────────────────────────────────────────────────
   No sharp, no resvg in this tree, and neither is worth a dependency for eight
   PNGs that change once a year. Chromium is already on any machine that runs the
   browser UI, so we point it at a page holding the SVG at exactly the size we want. */

const CHROMIUM = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];

const findChromium = async () => {
  for (const c of [process.env.CHROME_PATH, ...CHROMIUM].filter(Boolean)) {
    try { await access(c); return c; } catch {}
  }
  return null;
};

const rasterise = async (chrome, markup, size, out) => {
  const stage = await mkdir(path.join(tmpdir(), `agentcut-brand-${size}`), { recursive: true })
    .then(() => path.join(tmpdir(), `agentcut-brand-${size}`));
  const page = path.join(stage, "page.html");
  await writeFile(page, `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>
${markup}`);
  await run(chrome, ["--headless", "--disable-gpu", "--hide-scrollbars", "--default-background-color=00000000",
    `--window-size=${size},${size}`, `--screenshot=${out}`, "--virtual-time-budget=3000", `file://${page}`]);
  await rm(stage, { recursive: true, force: true });
};

/* ─── Write everything ──────────────────────────────────────────────────────── */

const full = GEOM.full, compact = GEOM.compact;

const SVGS = [
  ["public/brand/mark.svg", svg(flat(full))],
  ["public/brand/mark-compact.svg", svg(flat(compact))],
  ["public/brand/icon.svg", icon3d(full)],
  ["public/brand/icon-flat.svg", iconFlat(full)],
  ["public/brand/icon-flat-light.svg", iconFlat(full, "#141416", "#f2efe9")],
  // Next picks this up for the browser tab. Compact, because tabs render at 16px.
  ["src/app/icon.svg", iconFlat(compact)],
  ["src/common/components/agentcut-mark.tsx", component()],
];

/** Home-screen and store sizes. The small end uses compact for the same reason. */
const PNGS = [
  ["public/brand/icon-1024.png", icon3d(full), 1024],
  ["public/brand/icon-512.png", icon3d(full), 512],
  ["public/brand/icon-256.png", icon3d(full), 256],
  ["public/brand/icon-128.png", icon3d(full), 128],
  ["public/brand/icon-64.png", icon3d(compact), 64],
  ["public/brand/icon-32.png", iconFlat(compact), 32],
  ["src/app/apple-icon.png", icon3d(full), 180],
];

await mkdir(path.join(root, "public/brand"), { recursive: true });
for (const [rel, markup] of SVGS) await writeFile(path.join(root, rel), markup);
console.log(`wrote ${SVGS.length} files`);

const chrome = await findChromium();
if (!chrome) {
  console.warn(`no chromium found — skipped ${PNGS.length} png. Set CHROME_PATH and re-run.`);
} else {
  for (const [rel, markup, size] of PNGS) {
    await rasterise(chrome, markup, size, path.join(root, rel));
    console.log(`  ${rel}  ${size}×${size}`);
  }
}
