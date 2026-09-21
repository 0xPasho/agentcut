# agentcut

A local video editor for creating a new video from multiple assets or finding clips
in an existing video. Both workflows open the same editor: a preview canvas, asset
library, layered timeline, captions, audio, and export controls.

Human edits and agent edits use the same editing operations and saved project state.
You can edit visually, ask an agent to make changes, then continue editing yourself.

![The local editor with three video sources, a title layer, and the shared timeline](docs/images/editor.png)

## Quick start

Install **Node.js 22.13 or newer** and **pnpm 11.9.0**. A current Node LTS release
meeting that minimum is suitable. Node is required even if your pnpm installation
includes its own runtime: the app uses Node's built-in SQLite module.

If pnpm is not installed:

```sh
npm install --global pnpm@11.9.0
```

Download or clone this repository, open a terminal in its root directory (the folder
containing `package.json`), and run:

```sh
pnpm install --frozen-lockfile
pnpm dev --hostname 127.0.0.1
```

Open **http://localhost:3000**. Keep the terminal running; press **Ctrl+C** to stop.
No environment file, agent login, or transcription tool is required to start the
app and edit a video manually. Dependency installation needs internet access.

If port 3000 is occupied:

```sh
pnpm dev --hostname 127.0.0.1 --port 3100
```

Then open **http://localhost:3100**.

For full installation details, optional tools, and troubleshooting, see
[Setup and operations](docs/SETUP.md).

## Create your first video

1. Choose **Create a video** and name your project. You can start with an empty canvas.
2. Import videos or browse your local folders. The asset browser also exposes project
   media, reusable library assets, and online image sources.
3. Select an asset to preview it. Add it to the timeline, overlay it, or drag it onto a track.
4. Drag timeline blocks to move them in time or between tracks. Drag an edge to trim;
   hold near the viewport edge to scroll. Alt-drag onto Main reorders clips and closes gaps.
5. Add titles, images, or audio. Select a visual item to move or resize it on the canvas.
6. Edits autosave. Choose **Render**, wait for it to finish, then **Download** the MP4.

Rendering takes time and uses your machine's resources; changing an edit requires a
new render. The preview and export use the same composition implementation.

Use the back arrow to return to project information, create another output video,
or reopen an existing output. Adding footage to a generated clip continues that
same edit rather than creating a separate editor.

![Asset gallery with a floating source preview](docs/images/asset-preview.png)

*Screenshots show the running app with original illustrated demo media.*

## Build a video from a template

A template is the structure of a finished video — where the hook sits, how the captions
read, how often a picture is allowed to interrupt. Open **Templates** in the editor's
properties column, choose one, and press **Preview plan**: it lists every sentence and
marks the ones that would get a picture, without changing anything. **Apply** commits it.

Pictures land on the sentences that name something — a company, a product, a place, a
figure — and the sentences in between are left bare, which is what the cadence of a good
short actually looks like. A named brand resolves to its own logo rather than a stock
photo. A folder of screenshots can be handed to a template and used in order.

Adjust the sliders, press **Apply** again — re-applying replaces the template's own work
and leaves anything you placed by hand alone. **Save these settings as…** writes your own
template into `workspace/templates/`, where it sits alongside the built-in ones.

Templates work on a clip the agent found for you as well as on a video you assembled:
applying one promotes the clip in place, keeping its link and its footage.

Your coding agent has the same templates through the same tools, and is told which ones
exist before it starts. See [TEMPLATES.md](TEMPLATES.md).

**Rules** tell it when to use which: "when the clip is gameplay, use this template and no
pictures". A **glossary** keeps names spelled right in captions, and **preferences** say
how you like your videos in your own words. All three are files the panel, the agent and
the CLI share. See [RULES.md](RULES.md).

## Edit a set of raw videos

**Edit a set** takes several raw recordings and a sentence about what you want. Each becomes
its own video in one project: transcribed, captioned, given a hook and edited under one
shared plan so they read as a series. Open any of them to see the plan — what the agent
decided and why — change a decision and apply it again, or fix things on the timeline.
Approve the ones you like; **Render approved** renders only those. From the terminal:

```sh
node scripts/agentcut.mjs projects batch "Tips" --brief "Five tips for TikTok" a.mp4 b.mp4 c.mp4
```

## Find clips in an existing video

This workflow additionally needs:

- `whisper-cli` from whisper.cpp for local transcription.
- A supported agent CLI, installed and signed in: **Claude Code** or **Codex**.
- `yt-dlp` only when importing a video URL.

On macOS with Homebrew:

```sh
brew install whisper.cpp yt-dlp
brew install --cask claude-code
claude
```

Complete Claude's sign-in flow, exit its interactive session, and start agentcut
from a terminal where `claude` is on `PATH`. See the official
[Claude Code setup](https://code.claude.com/docs/en/setup) and
[whisper.cpp Homebrew formula](https://formulae.brew.sh/formula/whisper.cpp).

Choose **Find clips**, supply a local video or supported URL, and describe what you
want. The first transcription downloads the Whisper model automatically (about 1.6 GB
for the default `large-v3-turbo`, plus a small voice-activity model); subsequent runs
reuse them. The default model is multilingual and falls back to `small` if your
whisper.cpp build cannot load it; `AGENTCUT_WHISPER_MODEL` overrides the choice.

Word timings are snapped to the audio itself, and the segments the recogniser was
unsure of are proofread by the same agent CLI (set `AGENTCUT_TRANSCRIPT_POLISH=0` to
skip that). **Re-sync captions** in a project re-transcribes the source and refreshes
the words on every clip without touching your edits; the caption panel's **Sync**
slider is for sources whose own audio and video are offset.

The editor's **Edit with agent** action changes an existing edit without rerunning
the whole clipping workflow. Claude is preferred when both supported CLIs are
available and no provider is specified. CLI detection checks installation, not login.

## Local data and network use

Projects, imported media, and rendered files live in `workspace/` inside this checkout
by default. There is no required agentcut cloud account. Manual editing and rendering
do not require an agent login.

“Local” describes where the application, project state, transcription, and rendering
run. Agent requests can send prompts, transcripts, and sampled images to the chosen
provider. Online assets, URL imports, initial model/browser downloads, and agent
services require network access. Provider authentication, usage limits, and billing
still apply; agentcut does not make those services free.

The server exposes local media and file operations. The commands above bind it to
loopback. There is no built-in authentication for public hosting. To manage your
computer from another device, configure a private access solution separately; simply
running the app does not set up remote access.

See [workspace configuration and backups](docs/SETUP.md#workspace-and-backups).

## Headless commands

Run these from the repository root:

```sh
# Create an empty project, or assemble several sources.
node scripts/agentcut.mjs projects create "My video"
node scripts/agentcut.mjs projects create "Travel edit" /path/one.mp4 /path/two.mp4
node scripts/agentcut.mjs projects list

# Replace PROJECT_ID with an ID returned above.
node scripts/agentcut.mjs edit PROJECT_ID read
node scripts/agentcut.mjs edit PROJECT_ID ask "Move the title to the bottom"
node scripts/agentcut.mjs render PROJECT_ID

# Templates: see what exists, preview what one would do, then apply it.
pnpm exec tsx scripts/templates.ts list
pnpm exec tsx scripts/templates.ts plan PROJECT_ID explainer-broll
pnpm exec tsx scripts/templates.ts apply PROJECT_ID chat-story --slot screenshots=./my-screenshots
```

Or let the coding agent in your terminal drive the editor directly. Register the MCP server
once and the web shows what it does:

```sh
claude mcp add agentcut -- node /absolute/path/to/scripts/agentcut.mjs mcp
codex mcp add agentcut -- node /absolute/path/to/scripts/agentcut.mjs mcp
```

OpenCode: add the same command under `mcp` in its config. Every project tool is exposed as
`agentcut_<tool>` with a `projectId` argument; `agentcut_projects_list` finds the id.

No web server is required for these commands. To launch from another folder, use the
absolute path to `scripts/agentcut.mjs`; it resolves the checkout and default workspace.
Relative media paths for `projects create` resolve from your current terminal folder.

Clipping a local file from the command line:

```sh
pnpm exec tsx scripts/clip.ts /path/video.mp4 --provider claude --clips 6 --brief "Focus on the pricing discussion"
```

This script takes a local file, not a URL. Use **Find clips** in the UI for URL input.
Project-ID rendering reads authoritative saved state. Rendering an exported EDL JSON
file is a separate snapshot workflow; do not use stale JSON to continue a live edit.
See [EDITOR.md](EDITOR.md) for structured tool calls and revision conflict handling.

## Run a production build locally

Stop the development server before building in the same checkout:

```sh
pnpm build
pnpm start --hostname 127.0.0.1 --port 3000
```

Rebuild after updating application code. Both modes use the same configured workspace.

## Development and documentation

```sh
pnpm exec tsc --noEmit
pnpm test
pnpm test:render
```

Render tests use real media rendering and take longer than editing tests. See
[SETUP.md](docs/SETUP.md) for browser dependencies and first-run downloads.

- [Setup, configuration, troubleshooting](docs/SETUP.md)
- [Shared editor and agent tools](EDITOR.md)
- [Templates and image providers](TEMPLATES.md)
- [Rules, glossary and preferences](RULES.md)
- [Packs: share templates, rules and assets](PACKS.md)
- [Agent-first direction and status](AGENT-FIRST.md)
- [Sequences, layers, and timeline behavior](SEQUENCES.md)
- [Product requirements](SPEC.md)
- [Design conventions](DESIGN.md)
- [Contributor/agent instructions](AGENTS.md)

Rendering uses Remotion. Review its [licensing terms](https://www.remotion.dev/license)
for your intended use; dependency licenses are independent of this application's code.
