# Brand — the mark

agentcut's mark is a pair of scissors that is also a face. The two finger rings are
the eyes; the blades cross over a pivot that reads as a nose. One shape does both
jobs, which is why it never looks like a tool with a face stuck on it.

That double reading is load-bearing and fragile. Two things hold it up:

- **The rings carry the mass.** Shrink them and the blades become ears — it stops
  being scissors and becomes a cat.
- **The pivot dot stays.** Without it the blades don't read as crossing, and the
  cat comes back. It is the smallest element and the least removable.

## Two drawings

| | |
|---|---|
| **`AgentcutMark`** | Thicker blades, shorter reach, no tilt. Every use inside the UI, where nothing renders above 32px. |
| **`AgentcutMarkLarge`** | The full drawing: sharper tips, a 4° tilt, a glint in each eye. Wants 48px or more. |

The split is measured, not stylistic. Below about 32px the full drawing's tips fall
under a pixel and evaporate, and the mark reads as two dots. If you catch yourself
scaling `AgentcutMarkLarge` down to fit a toolbar, reach for the other one.

## Colour

The mark takes `currentColor`, like every other icon in the UI, and inherits state
from CSS. In the header it is `text-primary`. There is no second asset for a second
colour — if you need the mark in amber, colour the element.

The **app icon** is the one place with fixed colour: the graphite tile, `#2b2b30`
to `#0e0e10`, with the glyph in frosted white. It is a made object rather than a
tinted glyph, so it does not follow the theme.

## The app icon material

Built the way macOS draws icons now: the tile has its own bevel — a vertical
gradient, a light from the top left, and a 1px rim that brightens at the top and
again at the bottom. The glyph floats on it in frosted glass, with light inside its
top-left edge, shadow inside its bottom-right, and its own shadow cast onto the
tile. The eyes are real holes, so the bevel runs around them too.

Don't recolour the tile per surface. It is one object; a different colour reads as
a different app.

## The assets

Everything below is generated. Run `node scripts/brand-assets.mjs` after changing
the geometry in that file, and commit what it writes.

| Path | What it is |
|---|---|
| `src/components/agentcut-mark.tsx` | The two React marks. Generated — edit the script, not this file. |
| `public/brand/mark.svg` | Flat mark, `currentColor`, for anything outside React. |
| `public/brand/mark-compact.svg` | The same at UI sizes. |
| `public/brand/icon.svg` | The app icon, full material. |
| `public/brand/icon-flat.svg`, `icon-flat-light.svg` | Two flat inks on the tile, for print and stickers, where gradients and shadows don't survive. |
| `public/brand/icon-{1024,512,256,128,64,32}.png` | Raster icon, store and home-screen sizes. |
| `src/app/icon.svg` | Browser tab. Next wires it up from the filename. |
| `src/app/apple-icon.png` | Touch icon, 180px. Same. |

Not to be confused with `src/components/brand-marks.tsx`, which holds the *harness*
marks — Claude, Codex, Cursor — one monochrome path each. This file is the product's
own mark; that one is other people's.

## Regenerating

```sh
node scripts/brand-assets.mjs
```

The SVGs and the component need nothing. The PNGs need a Chromium to rasterise
with: the script looks for Chrome or Chromium in the usual places, and you can
point it somewhere else with `CHROME_PATH`. If it finds none it writes every SVG,
names the PNGs it skipped, and exits clean — so the component never goes stale just
because a machine has no browser installed.
