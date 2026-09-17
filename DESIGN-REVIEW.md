# Liquid Glass improvement review

## Implementation update

Implemented the shared Button, Glass, Input, Textarea, Tabs, Slider, Select, Dialog, Skeleton and Progress refinements. The import form now has an associated label, validation and mobile stacking. Library deletion uses a confirmation with cancellation and inline failure recovery. Navigation and inspected editing controls have accessible names; ready badges are neutral. The editor adapts to narrow screens, and timeline timestamps use readable secondary text. Full media thumbnails and further ambient-light experiments remain design proposals.

Validation: `pnpm exec tsc --noEmit`, `pnpm build`, and `git diff --check` passed. Browser checks used Chrome/Playwright with an isolated temporary workspace. Home and editor were checked at 1280px and 320px, including screenshots and horizontal overflow. Automated WCAG A/AA checks returned no violations in the tested home, library, editor, and deletion-dialog states. Keyboard checks covered tabs, sliders, select options, and cancellation focus restoration; deletion failure keeps the dialog open and permits retry. Reduced-motion computed styles were checked for buttons, menus, and dialogs. Build emits three filesystem-tracing warnings in the unchanged `src/lib/fileServer.ts`. These checks do not constitute a full screen-reader or cross-browser audit.

The review below records the original findings, before implementation. Its original verdict is retained as historical context.

## Scope and Coverage

Full source review of the home/import and library surfaces and their shared controls, with targeted inspection of project/editor navigation and caption controls. Stack: Next.js 16, React 19, Base UI/shadcn, Tailwind 4. Conventions inspected: AGENTS.md, CLAUDE.md, DESIGN.md. Preserve Figtree, the dark palette, solid content surfaces, and glass on the navigation layer.

This is a source-based review, not a completed visual or accessibility audit. Full timeline interactions, media rendering, search, and overlay editing are outside the boundary. Empty, pending, error, and populated states were inspected where defined in the reviewed components; none were exercised in a browser.

| Domain | Evidence inspected | Result |
| --- | --- | --- |
| Accessibility | Import field, navigation, caption controls, deletion, motion classes | 3 systemic findings |
| Layout | Import row, editor shell, library cards | Narrow-screen verification pending; see follow-up checks |
| Writing | Import action, library empty state and footer | 1 finding |
| Typography | Font loading, shared input sizing, truncated project/media titles | 1 finding |
| Colors | Button, badge, status mapping, theme tokens | 1 finding; rendered contrast not verified |
| UI | Glass, button, tabs, slider, select, dialog, card | 2 findings, plus visual proposals |

## Findings

| # | Severity | Domain | Location | Before | After | Why |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | HIGH | Accessibility | `src/components/new-project.tsx:98`; `src/components/caption-controls.tsx:42`; `src/components/library-view.tsx:56`, `:92`, `:121`; `src/components/clip-editor.tsx:134`; `src/components/project-view.tsx:121` | Placeholder-only source field; slider labels have no association; icon-only back/delete controls have no accessible name | Visible associated field labels, explicit slider names/units, destination-specific back labels and asset-specific delete labels | The controls need meaningful names independent of appearance. Check the rendered accessibility tree after implementation. |
| 2 | HIGH | Accessibility | `src/components/ui/dialog.tsx:56`; `src/components/ui/select.tsx:85`; `src/components/ui/skeleton.tsx:7`; `src/components/new-project.tsx:82`; `src/components/ui/button.tsx:6` | Zoom/slide, pulse, spin, and press movement lack reduced-motion handling | Gate motion on no-preference; use static pending cues and accessible status text when reduced motion is enabled | The material's own fallback does not cover the shared atoms or their consumers. |
| 3 | HIGH | Accessibility | `src/components/library-view.tsx:47`, `:92`, `:121` | Neutral trash controls immediately call `deleteAsset` | Explicit destructive confirmation or a real undo path | Deletion needs distinct treatment and protection against accidental activation. |
| 4 | MEDIUM | UI | `src/components/ui/button.tsx:13`; `DESIGN.md` Tinting | Opaque three-stop yellow gradient despite the documented transparent tint | Shared tinted action material, restrained top highlight, and context-aware treatment inside an existing glass container | The primary atom currently contradicts the intended material. Avoid nesting backdrop blur inside glass. |
| 5 | MEDIUM | Colors | `src/components/project-row.tsx:13`; `src/components/ui/badge.tsx:13` | Ready status uses the same filled yellow emphasis as the primary action | Neutral ready badge with a check icon; reserve filled yellow emphasis for the main action | Repeated statuses compete with the action hierarchy. Measure any revised text/background pairs. |
| 6 | MEDIUM | Typography | `src/components/project-row.tsx:36`; `src/components/library-view.tsx:113`; `src/components/clip-editor.tsx:138` | Important names use `truncate` without a local mechanism to expose the full text | Allow useful wrapping or provide an accessible full-name disclosure | Long projects, clips, and audio assets should remain identifiable. |
| 7 | LOW | UI | `src/components/ui/button.tsx:24`; `src/components/ui/select.tsx:43` | Small button variants override pills with 10–12px corners; selects use another shape | Define consistent capsule actions and a deliberate recessed field family, retaining compact sizes where needed | Shared geometry will make the component family more coherent. Verify actual nested radii in the browser. |
| 8 | LOW | Writing | `src/components/library-view.tsx:135`; `src/components/new-project.tsx:110` | Footer explains shipping licenses; source action says only “Add” | Keep the useful local-folder instruction, remove packaging rationale, use “Add video” | Product copy should describe the user's task. |

## Visual proposals to prototype

These are design directions, not browser-confirmed defects. Compare them in the rendered app before adopting them.

1. **A common material system.** Share tint, edge highlight, specular, and elevation tokens across floating controls. The existing Glass component already has a good layered foundation. Tune its thicker variant through tint and edge treatment as well as blur/shadow; avoid increasing blur everywhere.
2. **Tactile buttons.** Use consistent pills, a softly luminous primary action, neutral secondary fills, and a restrained press response. Specify transition properties instead of `transition-all`. Keep disabled, pending, focus, hover, and pressed states equally deliberate.
3. **Raised selected tabs.** Give the selected capsule a restrained top highlight and elevation over the inset track. Use a quick color/opacity transition; avoid animated travel on frequent editor interactions. No nested glass.
4. **Precision fields and sliders.** Use a shared recessed field treatment, clearer hover/focus feedback, a highlighted slider knob, readable value/unit pairing, and generous invisible hit areas. Preserve the existing native/Base UI interaction model.
5. **Coherent floating menus.** Match menu corners, edge highlights, shadow, and spacing to the floating chrome. Keep menu items simple fills. Keep content-heavy dialogs sufficiently solid for legibility rather than forcing translucency everywhere.
6. **Media-led project presentation.** Prototype thumbnails, useful duration/clip metadata, and a quiet ready indicator in place of visually prominent internal IDs. This should help users recognize projects as well as strengthen the studio character.
7. **More intentional import states.** Keep the drop zone solid; improve its drag highlight and pending/status presentation. Make the source field a labeled form area with a separate upload action rather than nesting every control inside a button-like card.

Recommended implementation order: repair control semantics and destructive states alongside Button/Glass; then tabs, fields, sliders and menus; then project presentation and import polish. Build a small component preview covering every state so future screens reuse a verified system.

## Considered but Rejected

| Location | Candidate | Rejected because |
| --- | --- | --- |
| `src/components/ui/card.tsx` | Make all cards transparent glass | Solid content surfaces preserve media and transcript hierarchy. |
| `src/components/ambient.tsx` | Add animated ambient blobs or pointer-following lighting everywhere | Constant motion and compositing cost have no demonstrated task benefit. Start with a static material comparison. |
| `src/app/layout.tsx` | Replace Figtree or add a display face | The existing family is intentional; consistency in the controls offers greater value. |

## Verification

- Source inspection: used `rg`, `cat`, and numbered reads of the cited components and convention documents. Confirmed findings above from their markup, classes, and handlers.
- `curl -I -s --max-time 3 http://localhost:3000`: connection failed; no preview was available on that port.
- Node resolution of `playwright` and `@playwright/test`: both unavailable from the project.
- **Not verified:** visual appearance, rendered contrast, keyboard traversal, screen-reader announcements, browser performance, reduced-motion rendering, 320px reflow, and 200% zoom. No application code changed; build/tests were not run for this review document.
- Prioritize responsive checks on `clip-editor.tsx:204` (fixed 340px sidebar inside a horizontal, overflow-hidden shell), `new-project.tsx:94` (unwrapped input/action row), and `library-view.tsx:120` (native audio controls in a row). These are source-level risk indicators, not claimed runtime failures.

## Verdict

Block — the confirmed accessible-name, motion-preference, and destructive-action findings remain. This verdict concerns the reviewed interface's readiness, not whether the Liquid Glass direction is appropriate.
