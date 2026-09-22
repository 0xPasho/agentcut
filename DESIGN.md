# Design — Liquid Glass

The UI is the human-facing view of the same editor the agent controls. Every editing
capability must be available through both interfaces, backed by shared operations and
project state. Visual polish must preserve that equivalence; a UI-only editing feature
is incomplete. See [the shared-editor contract](./SPEC.md#core-requirement-one-editor-two-interfaces).

agentcut follows Apple's Liquid Glass, in the dark palette we settled on. Everything is
built from the shadcn primitives in `src/common/ui/`, so a new screen is on-style by
using `<Glass>`, `<Button>`, `<Card>`.

**No hand-written CSS.** Tailwind utility classes only. The exceptions are the theme token
block and the `@custom-variant` declarations in `src/app/globals.css` — shadcn's and
Tailwind's own configuration mechanisms.

The mark itself — the scissors that are also a face — lives in [BRAND.md](./BRAND.md).

## Palette and type

Tokens are taken from the reference build we're matching: `#101010` ground,
`#171717` surfaces, `#1f1f1f` popovers, `#262626` raised fills, `#333` hairlines,
`#ffda2a` accent with `#ffff5e` at the top of the button gradient, `#ed8445` as the
secondary hue. Card radius is 24px; everything interactive is a pill.

Two deliberate departures: their muted grey is `#666`, which fails contrast for body
text, so ours is lighter; and their borders are solid grey hairlines rather than white
at low alpha, which is what gives surfaces their edge on a near-black ground.

**Type.** The reference uses `artlistSans` and `publicoBanner` (Publico, Commercial
Type) — both licensed, neither shippable. **Figtree** stands in: the same geometric
grotesque construction with open apertures, and it holds up at UI sizes. Don't swap it
for a system stack; the geometry is most of the character.

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
primary `<Button>` uses `bg-primary/85` with a translucent top highlight. Buttons use
tint without another backdrop filter, so they can safely sit inside a glass toolbar.

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


## Shared controls

- Buttons are capsules at every size. Primary actions use a yellow tint; secondary actions use neutral fills with a subtle top highlight. `static` disables press scaling for frequent or precision interactions.
- Fields are recessed, using `--field-shadow`; selected tabs and buttons use `--control-highlight`. Floating menus share the glass tint and elevation tokens; dialogs stay solid for reading.
- `--glass-shadow` and `--glass-shadow-raised` define elevation. Thick glass also uses the stronger tint, not just more blur.
- Sliders forward accessible names and value text to their thumbs. Keyboard focus is visible on the thumb, and the track has a generous interaction area.
- Motion is optional: press scaling and loading animation run only with no motion preference. Reduced-motion states retain their labels and icons.
- Ready badges stay neutral with a check icon so status does not compete with the primary action.

## Video project workspace

The home screen exposes two starting points, as tabs: **Make something** — one composer,
with the shape, the template and the agent chosen beside it — and **Clip a long video**.
Both open the same editor: clipping starts with footage; making something starts from a
sentence, a dropped video, or an empty canvas of the chosen shape. The composer is the
entry point, not a form: everything optional sits on its own row, and the gallery of
shapes under it collapses. Keep the existing caption, overlay,
transcript, properties, and agent controls together rather than introducing a second
assembly interface. The editor uses a glass navigation bar above media, timeline, and
inspector surfaces. Render is the primary action; media and editing actions stay neutral.
Desktop groups media on the left, preview/timeline in the center, and selected-shot
properties on the right. The right column is about the selection and nothing else: with
nothing selected it says so, and everything about the video as a whole — plan, templates,
rules, format — opens from one **Video** menu in the header. The controls a person reaches
for constantly (hook, colours, mute, split) sit on the frame itself, on the glass layer,
and disappear with the selection. Smaller widths stack these regions without page overflow;
the timeline has its own horizontal scroll. Reorder buttons provide a keyboard path.
Every visual operation uses the same sequence and item operations as the agent.

The project is an editor workspace: an asset browser sits beside the preview and timeline,
with selected properties and the agent on the other side. Asset tabs group Project,
Library, Folders, and Online sources without moving the user to separate pages. Local
folder access and remote image search are explicit actions; imported media is available
for reuse. On narrow clip-editor layouts the asset browser is opened on demand.

Clips and new videos have the same timeline and inspector, with no feature distinction
based on how editing began. Layer controls expose absolute timing, stacking order,
position, size, rotation, opacity, volume, mute, and visibility. Titles, images, and
audio may live on independent transparent layers spanning footage cuts. Generated
clips retain their identity when additional media is added. Information screens may
precede the editor, but must link each video directly and preserve existing clip URLs.

## Visual asset browsing

Use the reference’s quiet dark studio panels, rounded media thumbnails, fine surface
highlights, and restrained yellow actions. The editing workspace remains shared.
Asset cards are selectable previews, not immediate insertion buttons. Project and
Library offer a thumbnail grid, search, type filters, duration badges, and a used-in-edit
indicator. Selecting a card reveals a source viewer with explicit placement actions.
**Expand assets** provides a larger gallery alongside the source viewer; the editor
remains behind it. Video and audio previews never autoplay. Original footage can be
appended or overlaid; images and audio are placed at the playhead. Remote image
adoption imports an asset for inspection before placement. Existing shared tools and
operations retain the same editing semantics for agents.

Timeline interactions should communicate editing directly: one ruler, one playback
marker, recognizable media blocks, visible trim grips, drag ghosts, and insertion
markers. Ordinary dragging moves items freely in time and across every track,
preserving neighboring positions. Alt-drag onto Main explicitly reorders with gap closing. Do not duplicate the ruler with a separate playback slider or another effects
timeline. Keep output creation/switching on the project information screen, and
show numeric placement/trim fields on demand rather than as an always-open wall of forms.

Canvas drag feedback must move the content together with its selection border.
Fit standalone title selections to visible text, keep resize handles reachable,
and reserve playback controls from gesture hit areas. Timeline tracks share one
scroll viewport; avoid nesting another vertical scrollbar on the timeline card.
Use thin, low-contrast dark scrollbar thumbs while retaining native scrolling.

Modal reference: use a near-black translucent glass surface with a fine illuminated
edge, restrained 20px outer corners, and a blurred dim backdrop. Separate footer
actions with a subtle line and darker glass. Asset selection uses a broad thumbnail
gallery with overlaid names, floating previews anchored above the selected card, and a persistent footer containing
selection metadata and placement actions. Keep the yellow product accent for the
primary action. Desktop/mobile browser checks cover preview, placement, Cancel,
Escape focus restoration, overflow, and axe accessibility.
