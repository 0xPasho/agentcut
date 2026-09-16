# Design — Artlist style

Every screen in agentcut follows this system, and every screen is built from the shadcn
primitives in `src/components/ui/`. Those two rules are the same rule: the look lives in
the primitives, so a new page is on-style for free by using `<Button>`, `<Card>`, `<Input>`.

**No hand-written CSS.** Tailwind utility classes only. The single exception is the theme
token block in `src/app/globals.css`, which is shadcn's own theming mechanism.

## The look

Dark, quiet, and expensive. The interface recedes so the video doesn't compete with it.

| | |
|---|---|
| **Ground** | Near-black. Surfaces sit one step lighter, never pure white-on-black contrast. |
| **Radius** | Generous. Cards `rounded-2xl`/`rounded-3xl`, inputs `rounded-xl`, buttons and chips full pills. |
| **Borders** | Hairline white at ~8% opacity. A seam between surfaces, not an outline around them. |
| **Elevation** | Soft and diffuse, or none. Never a hard offset shadow. |
| **Accent** | One yellow, as a gradient, on the single primary action — usually with a soft glow behind it. Black text on yellow. |
| **Type** | Normal and medium weights, sentence case. White headings, grey secondary text. No uppercase display type. |
| **Navigation** | A pill container; the active item is a lighter pill nested inside it. |

## Rules that are easy to get wrong

- **The accent is scarce.** One yellow element per view. A second one destroys the
  hierarchy the whole style depends on — every other action is a dark pill.
- **Borders separate, they don't decorate.** If a hairline isn't dividing two surfaces,
  it probably shouldn't be there.
- **Grey text must still pass contrast.** Secondary text is grey, not invisible; keep it
  at or above 4.5:1 on its own surface.
- **Dark only.** There is no light mode. Don't add one without being asked.
- **Keep the focus ring.** A soft ring in the accent colour reads as part of the style and
  keeps keyboard navigation usable.

## Where it does not apply

Rendered video (`remotion/`) follows the caption style in the EDL, not this system —
those frames are viewed on TikTok, not inside the app.
