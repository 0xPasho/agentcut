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
- **Online:** the existing Wikimedia Commons/Openverse image search and adoption tools.
  Attribution is retained for exported credits. This is image search, not a new remote
  video or music provider integration.

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

## Timeline interaction

The editor has one time ruler and a draggable playback marker. Ordinary clip dragging
places items freely along any track or between tracks through `buildTimelineMove`,
which pins automatic neighbors to preserve their timing. Alt-drag onto Main inserts
between neighboring clips and closes gaps through `item.reorder`. Drag the ends of a clip to trim it.
The shared `buildTimelineTrim` adapter maps output movement through silence cuts,
bounds source footage, and resizes a standalone title/image/audio layer’s content.
Main-track trims ripple following clips; overlay timing stays fixed. Selected clip
effects appear under the same ruler rather than on a second timeline.

Drag asset thumbnails onto a track to add media there. Explicit placement buttons
remain available for keyboard and touch users. Project-level video creation and
selection live on the project information screen; the editor focuses on one output.
Precise position/audio and trim/split forms are collapsed until needed. Selecting a
visual clip exposes canvas handles automatically while playback is paused.

Timeline verification: 40 editing tests and 6 render tests pass. Browser checks
exercise mouse reorder and edge trim, keyboard reorder/trim, ripple deletion,
Escape cancellation, native video/image drops, effect nudging on the shared ruler,
and navigation back to project information. Desktop and 320px mobile checks found
no axe violations or horizontal page overflow in those tested states. Production
build passes with existing dynamic-filesystem tracing warnings.

Standalone title/image/audio items appear once on their track, labeled with their
content; selecting one opens its edit controls. Their internal full-duration effect
is not duplicated as a second, constrained draggable block. Nested clip effects
still appear below the tracks. Pointer gestures suppress native browser text drags.

Free-placement regression checks also verify short title blocks on a 44-second
timeline moving horizontally and between existing tracks, main-footage movement
away from zero, persisted positions after reload, and a single standalone title
block. Main reordering remains verified with Alt-drag. All 40 editing tests, 6 render
tests, the production build, and desktop/mobile browser accessibility checks pass.

Canvas manipulation previews the actual transformed content while dragging and
commits one `item.place` transaction on release; Escape/cancellation restores the
saved preview. Standalone title selection follows the rendered text bounds rather
than the transparent full-canvas layer. Title resizing anchors its top-left corner;
selection handles stay inside the preview and clear of playback controls. The
preview draft is temporary UI state; exported and agent-visible state remains the
shared saved transform.

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
