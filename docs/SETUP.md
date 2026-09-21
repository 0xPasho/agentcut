# Setup and operations

## Requirements

| Component | Needed for |
| --- | --- |
| Node.js 22.13+ | The app, scripts, and built-in SQLite |
| pnpm 11.9.0 | Installing the locked dependencies and running scripts |
| A modern browser | The visual editor |
| Claude Code or Codex, installed and authenticated | AI clipping and natural-language edits |
| `whisper-cli` | Transcription for clipping |
| `yt-dlp` | Video URL downloads |

FFmpeg and FFprobe are project dependencies; you do not need a system FFmpeg for
normal editing or export. `pnpm-workspace.yaml` permits the FFmpeg installation
script. Installing with build scripts disabled can leave that executable missing.

Development and browser checks have been performed on macOS. Linux and Windows
require compatible media binaries and render-browser dependencies; this repository
does not establish full cross-platform validation. On Windows, WSL is an option,
but install and run the app and its tools consistently inside the same environment.

For pnpm installation details, see the official
[installation guide](https://pnpm.io/installation). The repository pins 11.9.0 in
`package.json`; use its lockfile instead of generating a second package-manager lockfile.

## Installation and first launch

1. Install Node, Git if cloning, and the pinned pnpm version.
2. Obtain this repository and open its root directory in a terminal.
3. Run `pnpm install --frozen-lockfile`.
4. Run `pnpm dev --hostname 127.0.0.1`.
5. Open `http://localhost:3000` and choose **Edit**, **Clips** or **Chat**.

There is no separate database server or migration command required for a new
workspace. The app initializes its local SQLite database and workspace directories.
Allow enough free disk space for source copies, extracted audio, generated files,
and exports. Requirements grow with video duration and resolution.

For a non-development run, stop `pnpm dev`, run `pnpm build`, then
`pnpm start --hostname 127.0.0.1`. Do not run a production build concurrently with a
development server using the same `.next` directory.

## Optional AI and transcription setup

Install [Claude Code](https://code.claude.com/docs/en/setup), then run `claude` in a
terminal to authenticate. Check `claude --version` in the same shell that launches
the application. Restart the app after changing `PATH` or installing a provider.
The app invokes the CLI using its existing credentials; it does not have a separate
Claude API-key setting. Codex is also supported when its CLI is available and logged in.

On macOS, install transcription and URL tools with:

```sh
brew install whisper.cpp yt-dlp
whisper-cli --help
yt-dlp --version
```

For other systems, follow the upstream [whisper.cpp](https://github.com/ggml-org/whisper.cpp)
and [yt-dlp](https://github.com/yt-dlp/yt-dlp#installation) installation instructions.
The executable the app searches for is **`whisper-cli`**, regardless of package name.

The default Whisper model is `small`. The first transcription downloads
`ggml-small.bin` from the whisper.cpp model repository on Hugging Face. Its cache is:

```text
~/.cache/agentcut/models/
```

An existing `~/.cache/clipsmith/models/` directory is reused for older installations.
Keep multilingual models for non-English recordings; `.en` models are English-only.
If a model fails with `unknown tensor`, return to `small` and check compatibility
with your installed whisper.cpp version.

## Rendering and first-run downloads

Remotion renders video locally using a browser and the project's media tools. A
first render may download the required browser. You can prepare it explicitly:

```sh
pnpm exec remotion browser ensure
```

On Linux, install any system libraries required by that browser. Follow
[Remotion's browser dependencies](https://www.remotion.dev/docs/miscellaneous/linux-dependencies)
if it cannot launch. A successful browser install does not authenticate an agent.

Rendered MP4s are written under:

```text
workspace/projects/PROJECT_ID/clips/
```

Use **Download** after a render completes. The renderer can also write `CREDITS.txt`
for attributed assets. Exporting again uses the current saved revision when invoked
by project ID. Export filenames are derived from output IDs and titles.

## Configuration

Defaults work without a configuration file. For the web app, copy the example and
uncomment the settings you need:

```sh
cp .env.example .env.local
```

Next loads `.env.local` when starting the server. Restart after changing settings.
The standalone scripts **do not automatically load `.env.local`**. Export the same
variables in your shell when using both interfaces:

```sh
export AGENTCUT_WORKSPACE="/absolute/path/to/my-video-workspace"
node /absolute/path/to/repository/scripts/agentcut.mjs projects list
node /absolute/path/to/repository/scripts/agentcut.mjs dev --hostname 127.0.0.1
```

| Variable | Default | Purpose |
| --- | --- | --- |
| `AGENTCUT_WORKSPACE` | `<checkout>/workspace` | Media, project files, and SQLite database |
| `AGENTCUT_WHISPER_MODEL` | `small` | Transcription model |
| `AGENTCUT_MAX_HEIGHT` | `720` | Maximum requested URL download height |
| `AGENTCUT_AGENT_SHELL` | unset | Set to `1` to opt into the clipping agent's additional media-shell tools |
| `AGENTCUT_ROOT` | detected checkout | Internal root override; normally leave unset |

Prefer an absolute workspace path. Changing the workspace switches which projects
you see; it does not migrate existing projects. Do not run UI and CLI with different
workspace settings if they are meant to edit the same projects.

## Workspace and backups

The default layout includes:

```text
workspace/
  agentcut.db                 # authoritative project state
  projects/
    PROJECT_ID/
      media/                 # copied sources for general editing
      assets/                # project assets
      clips/                 # rendered MP4s
      editor-runs/           # agent request/response records
      edl.json               # exported representation, not the live database
```

Some files are created only when a workflow needs them. Older workspaces may use
`clipsmith.db`; that database takes precedence when present. Do not delete it merely
because an `agentcut.db` also exists.

To back up, stop the app and any CLI jobs, then copy the **whole workspace**, including
any SQLite `-wal`/`-shm` sidecar files. Also back up original files referenced through
local-path clipping: those may live outside the workspace. General-editor media
imports copy sources, but that does not make every legacy project self-contained.
Media references may contain absolute paths; moving a backup to a different machine
or location is not a guaranteed portable-project workflow.

To update the app, stop it, back up the workspace, obtain the updated code, run
`pnpm install --frozen-lockfile`, and rebuild if using production mode. Preserve
`.env.local` and the configured workspace. There is no global package installation
or automatic remote-access setup currently provided.

## Troubleshooting

| Symptom | Check or fix |
| --- | --- |
| `node:sqlite` unavailable | Check `node --version`; use Node 22.13+ in the shell running the app. |
| `pnpm` not found | Install `pnpm@11.9.0`, then reopen the terminal if needed. |
| Port already in use | Add `--port 3100` to `pnpm dev` or `pnpm start`, and open that port. |
| No agent CLI found | Check `claude --version` or `codex --version`; restart the app with the correct `PATH`. |
| Agent authentication or quota error | Open the provider CLI directly and resolve login or usage limits there. |
| `whisper-cli not found` | Install whisper.cpp and verify the executable is on `PATH`. |
| First transcription appears slow | The model may still be downloading; inspect the job/terminal logs. |
| URL import fails | Verify `yt-dlp` is installed and current, and that the source is accessible. |
| FFmpeg missing | Confirm dependency installation allowed the configured build scripts; run `pnpm rebuild ffmpeg-static`. |
| Render browser cannot launch | Run `pnpm exec remotion browser ensure`; check Linux browser dependencies where applicable. |
| Projects appear missing | Check `AGENTCUT_WORKSPACE`, the checkout location, and legacy database precedence. |
| Media disappeared after moving files | Restore the referenced originals; some clipping projects use external paths. |
| Agent/UI revision conflict | Read or reload current state, review the other edit, and retry only the intended changes. |
| Production server reports no build | Run `pnpm build` before `pnpm start`. |

## Verification

```sh
node --version
pnpm --version
node scripts/agentcut.mjs --help
pnpm exec tsc --noEmit
pnpm test
pnpm test:render
pnpm build
```

Tests create temporary workspaces. Render tests need working local media tools and
a render browser, and may need network access for the first browser download. They
do not require a live Claude session. Passing local tests does not certify every
operating system or third-party CLI version.
