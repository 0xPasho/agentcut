# Design — Liquid Glass

agentcut follows Apple's Liquid Glass, in the dark palette we settled on. Everything is
built from the shadcn primitives in `src/components/ui/`, so a new screen is on-style by
using `<Glass>`, `<Button>`, `<Card>`.

**No hand-written CSS.** Tailwind utility classes only. The exceptions are the theme token
block and the `@custom-variant` declarations in `src/app/globals.css` — shadcn's and
Tailwind's own configuration mechanisms.

## The material

Liquid Glass is layered: a tint that still lets content through, a lensed edge that bends
light around the silhouette, and a specular highlight along the top. `backdrop-saturate`
stands in for the way real glass concentrates the colour behind it — without it the
material reads as flat grey.

Larger glass simulates a thicker material: deeper shadow, more pronounced lensing. That is
the `thickness="thick"` variant.

## The two rules that matter most

**1. Glass belongs to the navigation layer.** It floats above content: the header bar, the
sticky control panel, floating actions. Content surfaces — clip cards, the agent log, the
transcript — stay solid. Apple's own words: making a table view glass "would make it
compete with other elements and muddy the hierarchy."

**2. Never glass on glass.** Stacking the material reads as cluttered. Inside a glass
container, use fills and vibrancy (`bg-white/8`, `bg-white/14`) so the inner element feels
like a thin overlay that is part of the material.

## Variants

| | |
|---|---|
| **Regular** | The default. Legible over any content, at any size. Use this unless all three clear conditions hold. |
| **Clear** | Only when the element sits over media-rich content, *and* a dimming layer won't hurt that content, *and* what sits on top is bold and bright. It has no adaptive behaviour and needs the dimming layer to stay legible. |

**Never mix the two in one view.**

## Tinting

Tint brings emphasis to the **one primary action** in a view — nothing else. Tint every
element and nothing stands out.

Tint, never a solid fill. A solid fill is opaque and breaks the character of the material;
the tinted version stays transparent and grounded in its environment. That is why the
primary `<Button>` is `bg-primary/85` over a backdrop blur rather than a flat yellow.

## Shape and concentricity

- Capsules for bars and buttons: radius is half the height.
- Nested shapes are concentric: **inner radius = parent radius − padding**. Pinched or
  flared corners break the balance.
- Glass nests into the rounded corners of its container, not against them.

## Scroll edge effects

Where content scrolls under a glass element, it dissolves into the background instead of
meeting a hard divider (`<ScrollEdge>`). **One effect per scrolling view** — never stacked.

In steady states, avoid content intersecting glass at all: reposition or scale instead.

## Accessibility

Apple applies these as automatic modifiers; on the web they are media queries, so the
`<Glass>` component handles them via custom variants:

| Setting | Behaviour |
|---|---|
| `prefers-reduced-transparency` | Frostier — blur off, opaque surface, more of the content behind obscured. |
| `prefers-contrast: more` | Predominantly solid with a contrasting border. |
| `prefers-reduced-motion` | Elastic and glow effects drop out. |

Secondary grey text must still clear 4.5:1 against its own surface.

## Don'ts

1. Glass in the content layer.
2. Glass stacked on glass.
3. Regular and clear mixed in one view.
4. Clear without all three of its conditions.
5. Solid fills where the material should be tinted.
6. More than one tinted element per view.
7. Content intersecting glass in a steady state.

## Where it does not apply

Rendered video (`remotion/`) follows the caption style in the EDL — those frames are
watched on TikTok, not inside the app.
