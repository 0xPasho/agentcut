# Local video projects

The application now supports two starting flows into the same local workspace:

- **Find clips:** analyze a source video and produce independently editable highlights.
- **Create a video:** open an empty canvas in the same editor, then add videos, titles, images, and audio.
  No agent, transcription service, or hosted account is required for manual assembly.

A project can hold source media and multiple sequences. Each sequence is one output
video, with its own name, dimensions, frame rate, and layered timeline items. An item
references a media ID (or `null` for a source-free canvas scene) and contains the existing `Clip` editing properties: source
in/out, crop/split framing, transcript words, caption styling, and all supported edits.

## Use the visual editor

Choose **Create a video** on the home screen, name the project, and choose **Open editor**.
No footage is required. Optionally select starting videos (or enter local paths);
they appear on the initial timeline in the selected order. Files are copied into the project's local `media/` folder, so moving
the originals does not break the project. Invalid media rejects the import.

Both flows render the same `ClipEditor` component. A project is the editable canvas
and its assets, not a separate assembly interface. Start with **Add blank scene** or
**text**, or place an image/audio asset directly on the empty timeline. Canvas scenes
use the same editing properties and rendering composition as footage-backed scenes.

In the editor:

- Import additional sources and add footage to any sequence.
- Create and switch between multiple output videos.
- Move items earlier/later, remove them, trim their source in/out, or split them.
- Set an absolute start time and layer, overlap videos, and place a video in a corner.
- Adjust each layer’s position, size, rotation, opacity, volume, mute, and visibility.
- Place titles, images, and audio on independent canvas layers, including music spanning cuts.
- Use **Captions** and **Add** for common shot edits. Source-frame
  capture uses the selected shot’s media, through the same `assets.capture` tool.
- Open **All scene properties** for captions, transcript words, titles, images, music,
  sound effects, silence cuts, punch-ins, crop keyframes, and split framing.
- Change each video's dimensions and frame rate in **Video settings**.
- Use **Edit with agent** to continue the same saved edit, or **Render** to render.
- Generated clips open in this same layered editor. The first saved edit promotes the
  clip in place, keeping its ID, title, output settings, source selection, and edits.
  Adding footage extends that edit; it does not create an independent copy. Project
  information screens link each saved video individually.

## Shared operations and persistence

All changes use the existing pure operation engine, SQLite revision checks, draft
recovery, and editor tool transport. This is not a second persistence or rendering
engine. UI and agent boundaries use the same validation.

| Operation | Behavior |
| --- | --- |
| `clip.promote` | Promote a generated clip in place to a timeline with the same ID |
| `item.place` | Set start time, layer, transform, volume, mute, or visibility |
| `media.add` | Register source metadata (normally emitted by the import service) |
| `media.remove` | Remove unused media from the project; reject if still referenced |
| `sequence.add` / `sequence.remove` | Create/delete an output timeline |
| `sequence.patch` | Change the sequence name or output settings |
| `item.add` | Insert a video or source-free canvas item at an index, or append it |
| `item.remove` | Remove an item without deleting its source |
| `item.move` | Move an item to a zero-based destination index |
| `item.patch` | Update changed clip properties; optional `before` protects staged edits |
| `item.split` | Split at seconds relative to the item's source start, before silence cuts |
| `item.source` | Replace an item's footage in place, keeping its slot, overlays and placement |

`media.import` and `media.upload` are project tools accepting an `expectedRevision`.
Both use the same probing/copying service as visual imports. Path imports read a local
file on the user's machine; uploads accept a filename and base64 bytes. Agents should
use these services rather than inventing paths or source metadata.

Import failures remove their incomplete copies. A stale revision rejects registration
and removes the uncommitted copy. Removing a media entry does not delete its original
file or automatically reclaim its workspace copy.

Old EDLs parse with empty `media` and `sequences` collections. Existing clips retain
IDs and edits. Opening a page does not write a migration. On the first edit,
`clip.promote` registers the primary source as reusable media and replaces the clip
with a timeline of the same ID in the same atomic batch. Existing `/c/<id>` links
continue to open it, and exports retain the output ID. Revision rules still determine
whether an older download is current.

## Preview and export

`sequenceFrames()` allocates output frames identically for the timeline, Remotion
Player, and export. `SequenceComposition` composes the existing `ClipComposition` for
each item, so source audio, captions and edits use the same runtime in both previews
and finished videos. Imported sources can have different dimensions and frame rates.
Sources from older projects outside the workspace are served through explicit local
file aliases during export.

UI jobs, `project.render`, and CLI rendering resolve the same saved revision. `only`
accepts sequence IDs as well as legacy clip IDs. Downloads are revision-specific.
Empty sequences can be saved but cannot be exported.

## Run from any folder

The default workspace resolves against the installation checkout, not the terminal's
working directory. The existing checkout's workspace is retained. An absolute
`AGENTCUT_WORKSPACE` selects another workspace consistently across entry points.

```bash
node /path/to/agentcut/scripts/agentcut.mjs dev
node /path/to/agentcut/scripts/agentcut.mjs projects list
node /path/to/agentcut/scripts/agentcut.mjs projects create "Empty canvas"
node /path/to/agentcut/scripts/agentcut.mjs projects create "My film" ./one.mp4 ./two.mp4 ./three.mp4
node /path/to/agentcut/scripts/agentcut.mjs edit PROJECT_ID read
node /path/to/agentcut/scripts/agentcut.mjs edit PROJECT_ID ask "Move the last shot first and trim it to two seconds"
node /path/to/agentcut/scripts/agentcut.mjs render PROJECT_ID --only SEQUENCE_ID
```

Creation, read, structured edits, and rendering do not need the web server running.
`projects create` calls the same creation service as the visual form. Paths supplied
to the launcher resolve relative to the caller; instruction text and project names
are forwarded literally. This is a checkout launcher, not a global package install.
Remote-device access is not part of this feature.

## Current scope and verification

The timeline supports overlapping video and source-free layers, with hard cuts.
Each item's optional `at` is its absolute start in output seconds. With no `at` (or
`null`), it follows the previous item on its own layer. Higher `layer` values draw
above lower values; items on the same layer retain timeline order. `transform`
contains `x`, `y`, `width`, and `height` in output-frame percentages, `rotation` in
degrees, and `opacity` from 0 to 1. `volume` ranges from 0 to 2; `muted` silences an
item and `hidden` hides its visuals. Source-free layers have a transparent background,
so titles, images, and audio can span cuts without covering the footage underneath.
The final uncovered background is black.

Transitions, keyframed layer transforms, and automatic transcription of newly
imported sources are not implemented. Existing source-crop keyframes remain supported.
Per-item captions can be authored through properties or carried in from generated clips.
The existing manual conflict resolution, transcript-extension, and crashed-render-lock
limitations documented in [EDITOR.md](./EDITOR.md) still apply.

`pnpm test` covers multi-source state, HTTP/tool parity, trim/split/reorder behavior,
rollback, media references, import cleanup, legacy compatibility, and workspace paths.
`pnpm test:render` generates distinct source videos and verifies shot order, duration,
audio presence, and decoded-frame equivalence across UI-service, agent-tool, and CLI
exports. Browser checks cover multi-file creation, editing, external-agent handoff,
export/download, accessibility, and 320px layout.

A live authenticated Claude Code run also continued a browser-created three-source
project through the file tool transport: it moved the last shot first, trimmed its
source range, and renamed the sequence in one revision-checked save, preserving the
other shots and output settings. This is targeted smoke coverage, not an exhaustive
provider evaluation.

## Unified asset workspace

The shared editor has an **Assets** browser alongside
preview, timeline, properties, and agent controls. On narrower clip-editor screens,
**Browse assets** opens the browser without permanently taking preview space.

- **Project:** source videos, imported images/audio, and library assets used in the edit.
- **Library:** reusable images and audio, with image thumbnails and audio previews.
- **Folders:** explicitly browse a folder on this machine, move into subfolders/up to
  parents, and import supported videos, images, or audio. Listings are nonrecursive,
  omit hidden/unsupported entries, and paginate at 100 entries.
- **Online:** image search and adoption. Brand logos (Simple Icons, CC0) answer when the
  query is a company or product name; Wikimedia Commons and Openverse need no key. Pexels,
  Unsplash and Google Programmable Search are used only when their keys are configured and
  return nothing otherwise. `assets.providers` reports which are available. Attribution is
  retained for exported credits. This is image search, not a new remote video or music
  provider integration.

Source videos have inline previews and timeline placement controls. Images and
music/sound effects are placed at the playhead. These capabilities are identical
whether the editor began with a generated clip or an empty canvas.

The shared tools `assets.browseLocal` and `assets.importLocal` expose the same local
folder workflow to agents. `media.import` imports videos. `item.edit.add` atomically
appends an edit to a sequence shot; `edit.add` does the same for a legacy clip. File
imports copy originals into the workspace. Asset membership is tracked separately
from content deduplication, so reusing the same file in multiple projects makes it
available in each project's browser without duplicating its stored content.

The empty-canvas flow is also verified with title-first, image-first, and audio-first
creation, schema-properties edits, three later video imports, shared agent-tool updates,
render/download, and deleting/recreating the final sequence. Source-free render tests
check actual title/image pixels and audio, alongside existing multi-source and legacy
UI/tool/CLI export parity. Desktop and 320px browser checks report no page overflow
or automated accessibility violations in the tested states.

Layered editing verification: 34 domain/workspace tests and six real-render tests pass.
Exports verify overlapping video pixels, rotation, opacity, music across cuts, gain,
mute, visual hiding, UI/tool/CLI equivalence, and identical decoded video/audio when
a legacy clip is promoted in place. Browser checks cover the same controls on both
entry routes, pointer and keyboard movement, canvas resizing, title duration, agent
handoff, render/download, and no automated accessibility violations or 320px overflow
in the tested states. Use **Overlay at playhead** for picture-in-picture, select a timeline clip to move/resize its visual, and **Position & audio** for exact values.
Timeline blocks can be dragged or nudged with arrow keys; Shift nudges one second.

The asset browser now uses selectable thumbnail cards with type filters, search,
durations, used indicators, and a dedicated source preview. **Expand assets** opens
a larger gallery/viewer. Selecting or playing a source does not change the timeline;
placement is an explicit separate action. Online image adoption also imports first
for inspection. Browser checks verify video/audio playback, selection without edits,
explicit placements, desktop/mobile accessibility, and Escape dismissal.

## Templates

A template applies structure to one sequence: caption styling, dead-air cuts, punch-ins,
emphasis, a hook on its own canvas layer, optional title cards, and pictures placed on the
sentences that name something. It is not a separate assembly path — `template.apply` builds
`EditorOperation[]` and commits them through the same revision-checked store, so everything
it writes is an ordinary timeline item or edit. Every generated edit carries
`by: "template:<id>"`, which is what lets a second apply replace the template's own work while
leaving hand-made edits and hand-edited layers alone. A generated clip named as the target is
promoted in place first. See [TEMPLATES.md](./TEMPLATES.md).

Rules decide when a template applies: a plain-language condition an agent judges, and a
structured action (template, overrides, instruction) the host executes through
`template.apply`, marked `template:<id>/rule:<ids>`. A workspace glossary and preferences
reach every agent prompt and the transcription. See [RULES.md](./RULES.md).

Template verification: sentence segmentation, salience, cue spacing/density, application from
the HTTP and tool transports, re-application preserving hand edits, stills captured from the
footage, uncapitalised transcripts, structural cards, and the registry are covered by `pnpm test`. `pnpm test:render` exports a real video and checks that the planned
pictures appear in folder order at the planned beats, the gaps between them stay bare, the
hook layer survives every cut, and dead air is removed. Browser checks confirm the panel
plans and applies a template, its slot inputs, the online provider chips, no axe violations
on the editor page, and no horizontal overflow from the panel in a 288px column. A live
render also confirmed two brand marks placed side by side with the footage visible between
them, and that a corner watermark holds across every cut. A three-shot render was read
frame by frame either side of each cut: footage changes while the hook, the corner mark
and the ducked music bed hold, and each shot's pictures land on its own sentences. A live Claude Code run through
the file tool transport chose a template with `templates.suggest`, dry-ran it and applied
it without placing anything by hand. Production build passes.

## Timeline interaction

The editor has one time ruler and a draggable playback marker. Ordinary clip dragging
places items freely along any track or between tracks through `buildTimelineMove`,
which pins automatic neighbors to preserve their timing. Alt-drag onto Main inserts
between neighboring clips and closes gaps through `item.reorder`. Drag the ends of a clip to trim it.
The shared `buildTimelineTrim` adapter maps output movement through silence cuts,
bounds source footage, and resizes a standalone title/image/audio layer’s content.
Main-track trims ripple following clips; overlay timing stays fixed. `buildTimelineSlip`
changes which part of the footage a clip shows without moving it or changing its length: it is
one `item.patch` that moves both bounds and passes the author's overlays through unchanged, so
the engine's own rebasing carries the transcript and crop with the footage while titles stay
where they were put. It is bounded by the source at both ends, and the Trim & split panel drives
it, so slipping needs no hidden modifier and no new operation. Selected clip
effects appear under the same ruler rather than on a second timeline, and each one has the same
two edges a clip has: dragging them changes how long that title, zoom or sound runs, in the
clip's own source time, bounded by the clip that carries it.

Dragging snaps: a moved clip, a trimmed edge and an incoming asset all lock onto the
origin, the playhead and any other item's edges through the shared `snapTargets`/`snapSpan`
helpers, whichever of the moving span's two edges is closer. A white guide marks what it
locked onto. Snapping is a visible toggle in the timeline toolbar, and holding Command or
Control inverts it for the length of one drag. Only an edge that actually moves in output
time can snap, so trimming the head of a packed main clip still ripples instead of sliding.

Drag asset thumbnails onto a track to add media there, or drop video, image and audio files
straight from the desktop onto the track and position where they should land; both routes
ingest through the same import service and then place through the same operations. The drop
preview shows the real footprint of what is arriving, not a bare insertion line. Dropping
media onto the middle of a compatible clip replaces that clip's footage through `item.source`
(or, for a title/image/sound scene, patches only that scene's `src`), keeping its position,
trim and overlays; the outer fifth of a clip still inserts. Dropping onto the preview frame
places the media where it was dropped, carrying the spot into the item transform or the image
overlay's own coordinates. Right-clicking a clip opens split, duplicate, mute, hide and remove. Every way of adding media is draggable, not only clickable: project and library assets,
files listed in the folder browser, online image results, and files dragged in from the
desktop. Each lands through its own existing service — `media.import`, `assets.importLocal`,
`assets.adopt`, the upload route — and is then placed with the ordinary timeline operations
where it was dropped. Dropping files on the asset panel imports them without placing anything. The same holds
outside the editor: both start flows and the library page take a drop wherever they take a
click, and each one says what it will accept before the drop lands rather than failing after it. Dragging past either end of
the visible timeline scrolls it, and the playhead snaps to the same targets while scrubbing.
Stacking two clips on one track is legal — items layer by array order — but it hides one behind
the other, so a move or drop that would do it is drawn hatched and labelled before it lands,
through the shared `timelineCollides` check.
Command or Control with the wheel — a trackpad pinch — zooms the timeline around the pointer,
keeping the moment under it still; Shift with the wheel scrolls sideways. Transport keys work
wherever you are looking: Space or K plays and pauses, `,` and `.` step a frame, Up and Down
jump to the previous or next cut — every edge the snapping engine already knows about — and
Home and End jump to the ends. Space defers to a focused button or link so it never steals a control's key,
and a step reads the player's live frame so holding the key does not repeat from a stale one.
Clips copy and paste (Cmd/Ctrl + C and V) with their trim, overlays and placement intact.
Several clips can be selected at once — Shift- or Command-click, or sweep a band across
empty track space — and dragging any of them moves the whole selection in one
`buildTimelineGroupMove` transaction that freezes every clip left behind at the time it
resolved to. Delete removes the selection together, the timeline header says how many clips are held and
offers to let go of them, and Escape clears it. Removing from Main closes the gap only while
that track is still following on its own: once its clips carry times the author set by hand,
a removal leaves every other clip where it was, because packing the track would discard them. The selection is view state: it never reaches
the project, only the next transaction. Trim handles belong to the one clip being edited, so a
selection of several never covers the timeline in handles.
Every drag has a click equivalent, so nothing here is mouse-only: assets and folder files
have add buttons, online results adopt on click, desktop files come in through Import, and
a compatible selected clip can be swapped from the asset panel's Replace action instead of a
drop. Each track's label opens a menu — select its clips, move the track up or down among the
overlays (an ordinary group move), or clear it — which keeps track order reachable without a
pointer. Selecting several clips at once remains a pointer gesture; every edit it enables is
available one clip at a time from the keyboard.

Changes that are easy to miss or hard to reverse — a removal, a replacement, an import, or
an add from the asset panel, which happens away from the timeline — confirm themselves in a
toast that carries Undo. A drag that lands in view stays quiet, as do ordinary moves and
trims; those only announce themselves to assistive technology.

Inverting a batch normally replays it one operation at a time, since each inverse is read
against the state before its own operation. A batch of placements or patches on distinct items
never reads its siblings, so those — group moves, track swaps, the packing of a whole track —
invert against the original state in one pass instead, which keeps drag release off a quadratic
path. Undo and redo (Command or Control + Z, and the toolbar buttons) replay inverse operations
through the shared engine and the ordinary revision protocol, so they obey the same
validation as any other edit rather than restoring a remembered EDL. Reloading the project
clears the history, because it describes edits against the state being replaced. Project-level video creation and
selection live on the project information screen; the editor focuses on one output.
Precise position/audio and trim/split forms are collapsed until needed. Selecting a
visual clip exposes canvas handles automatically while playback is paused.

Timeline verification: 40 editing tests and 6 render tests pass. Browser checks
exercise mouse reorder and edge trim, keyboard reorder/trim, ripple deletion,
Escape cancellation, native video/image drops, effect nudging on the shared ruler,
and navigation back to project information. Desktop and 320px mobile checks found
no axe violations or horizontal page overflow in those tested states. Production
build passes with existing dynamic-filesystem tracing warnings.

A source clip draws a strip of frames sampled evenly across what it actually shows, so the
strip changes with the footage instead of repeating one frame; samples are cached per source
and range, at most two sources are sampled at a time, and a source that will not decode simply
has no strip. A sound on the timeline draws its own waveform: the file is decoded once in the browser, its
average energy is sampled into fixed buckets, and the shape is drawn to fit whatever width the
clip has at the current zoom. Decoded peaks are cached per file, and a file that cannot be
decoded keeps its plain block — the waveform is a reading aid, never a requirement.

Standalone title/image/audio items appear once on their track, labeled with their
content; selecting one opens its edit controls. Their internal full-duration effect
is not duplicated as a second, constrained draggable block. Nested clip effects
still appear below the tracks. Pointer gestures suppress native browser text drags.

Free-placement regression checks also verify short title blocks on a 44-second
timeline moving horizontally and between existing tracks, main-footage movement
away from zero, persisted positions after reload, and a single standalone title
block. Main reordering remains verified with Alt-drag. All 40 editing tests, 6 render
tests, the production build, and desktop/mobile browser accessibility checks pass.

Canvas placement is magnetic in the same way the timeline is: a dragged layer catches the
frame's edges and its centre through the shared `snapAxis`, drawing the guide it caught, and
Command or Control passes them by. Holding Shift while resizing keeps the layer's proportions.
Canvas manipulation previews the actual transformed content while dragging and
commits one `item.place` transaction on release; Escape/cancellation restores the
saved preview. Standalone title selection follows the rendered text bounds rather
than the transparent full-canvas layer. Title resizing anchors its top-left corner;
selection handles stay inside the preview and clear of playback controls. The
preview draft is temporary UI state; exported and agent-visible state remains the
shared saved transform.

The content inside a layer moves too. While a layer is selected, every visible title,
picture and the caption block inside it gets its own handle: dragging one writes the
overlay's free position (`x`/`y` for a title or picture, `positionY` for captions) through
one `item.patch`, previewing the real composition until release and snapping to the
frame's edges and centre with the same guides a whole layer gets. Captions keep their
horizontal centring and only move up and down. A press that does not move selects the
overlay so its controls open; arrow keys nudge by 1% and Shift by 5%. A title with a free
position keeps its preset width, so it wraps exactly as before; choosing a preset again in
the Selected panel or the Add panel clears the free position. A grid of thirds, the centre
and a 10% mesh covers the frame for the length of any canvas drag, including media dragged
in from the asset panel, so the size of what is moving stays legible against the frame.

Canvas browser checks verify live title/video movement, title-sized selection,
no saved mutation before release, no release jump, Escape restoration, live title
resizing, and one timeline scroll ancestor with thin dark scrollbars. The tested
portrait layout passes axe and has no page overflow at 320px. Build, 40 editing
tests, and 6 render tests pass.

Timeline edge scrolling runs continuously during a pointer drag, including while
the pointer is stationary near an edge. Scroll displacement participates in the
shared trim delta. Moving/extending an item can grow the horizontal timeline at a
fixed pixel-per-second scale rather than hitting the viewport boundary. Release,
Escape, and pointer cancellation stop the animation; only release saves the edit.
Browser checks verify zoomed edge scrolling, extension beyond the previous timeline
end at default zoom, persisted duration, and Escape rollback. Editing tests: 40 pass;
production build passes.
