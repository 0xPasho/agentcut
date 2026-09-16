# Design — neo-brutalism

Every screen in agentcut is neo-brutalist, and every screen is built from the shadcn
primitives in `src/components/ui/`. Those two rules are the same rule: the look lives in
the primitives, so a new page is on-style for free by using `<Button>`, `<Card>`, `<Input>`.

**No hand-written CSS.** Tailwind utility classes only. The single exception is the theme
token block in `src/app/globals.css`, which is shadcn's own theming mechanism.

## The look

| | |
|---|---|
| **Borders** | 2px, `border-foreground` — near-black, never a soft grey. Every surface is outlined. |
| **Shadows** | Hard offset, zero blur: `shadow-[4px_4px_0_0_var(--foreground)]`. Never a blurred drop shadow. |
| **Radius** | `--radius: 0`. Square. A 2–4px radius is the most any element gets. |
| **Fills** | Flat. No gradients, no glass, no soft elevation. |
| **Type** | Headings uppercase, `font-black`, `tracking-tight`. Body stays sentence case. |
| **Colour** | Cream background, near-black ink, one loud accent. Accent is for the primary action and the active state — nothing else. |
| **Press** | The element translates into its own shadow: `active:translate-x-[3px] active:translate-y-[3px] active:shadow-none`. That motion *is* the feedback. |

## Palette

Yellow accent on cream, black ink. Destructive is the only other hue, and it stays loud
rather than muted — this style has no quiet states.

## Rules that are easy to get wrong

- **A border is not decoration.** If a thing is a surface, it is outlined. Half-outlined
  layouts read as broken rather than minimal.
- **Shadow direction is constant.** Everything casts down-right. One light source.
- **One accent per view.** Two competing accents kills the contrast the style depends on.
- **Uppercase is for labels and headings**, not for paragraphs or transcript text — it
  destroys readability at length, and this app shows a lot of Spanish body copy.
- **Keep the focus ring.** Brutalism is high contrast, so a thick `ring-2` offset ring fits
  the style and keeps keyboard navigation usable.

## Where it does not apply

Rendered video (`remotion/`) follows the caption style in the EDL, not this system —
those frames are viewed on TikTok, not inside the app.
