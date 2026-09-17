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
want. The first transcription downloads the Whisper model automatically; subsequent
runs reuse it. The default `small` model is multilingual.

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
```

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
- [Sequences, layers, and timeline behavior](SEQUENCES.md)
- [Product requirements](SPEC.md)
- [Design conventions](DESIGN.md)
- [Contributor/agent instructions](AGENTS.md)

Rendering uses Remotion. Review its [licensing terms](https://www.remotion.dev/license)
for your intended use; dependency licenses are independent of this application's code.
