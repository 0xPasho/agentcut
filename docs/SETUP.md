# Setup and operations

## Requirements

| Component | Needed for |
| --- | --- |
| Node.js 22.13+ | The app, scripts, and built-in SQLite |
| pnpm 11.9.0 | Installing the locked dependencies and running scripts |
| A modern browser | The visual editor |
| An agent CLI, installed and signed in: Claude Code, Codex, Cursor (`cursor-agent`) or OpenCode | AI clipping and natural-language edits |
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
5. Open `http://localhost:3000` and either say what you want or choose **Clip a long video**.

There is no separate database server or migration command required for a new
workspace. The app initializes its local SQLite database and workspace directories.
Allow enough free disk space for source copies, extracted audio, generated files,
and exports. Requirements grow with video duration and resolution.

On macOS the server cannot read `~/Downloads`, `~/Desktop` or `~/Documents` unless the
app that launched it — your terminal or editor — is allowed to. The symptom is a
permission error ("macOS is blocking this folder") when you choose a file from one of
those folders. Open System Settings → Privacy & Security → Full Disk Access, allow that
terminal or editor, and restart the server.

For a non-development run, stop `pnpm dev`, run `pnpm build`, then
`pnpm start --hostname 127.0.0.1`. Do not run a production build concurrently with a
development server using the same `.next` directory.

## Optional AI and transcription setup

Four harnesses are supported: [Claude Code](https://code.claude.com/docs/en/setup)
(`claude`), Codex (`codex`), Cursor (`cursor-agent`, not `cursor`, which is the editor)
and OpenCode (`opencode`). Install at least one, run it once in a terminal to sign in,
and check `claude --version` (or the other CLI's) in the same shell that launches the
application. Restart the app after changing `PATH` or installing a provider. The app
invokes the CLI with its existing credentials; it has no API-key setting of its own.
`AGENTCUT_CLAUDE_BIN`, `AGENTCUT_CODEX_BIN`, `AGENTCUT_CURSOR_BIN` and
`AGENTCUT_OPENCODE_BIN` point at a binary that is not on `PATH`.

On macOS, install transcription and URL tools with:

```sh
brew install whisper.cpp yt-dlp
whisper-cli --help
yt-dlp --version
```

For other systems, follow the upstream [whisper.cpp](https://github.com/ggml-org/whisper.cpp)
and [yt-dlp](https://github.com/yt-dlp/yt-dlp#installation) installation instructions.
The executable the app searches for is **`whisper-cli`**, regardless of package name.

The default Whisper model is `large-v3-turbo`. The first transcription downloads
`ggml-large-v3-turbo.bin` (about 1.6 GB) and the Silero voice-activity model from the
whisper.cpp model repositories on Hugging Face. Their cache is:

```text
~/.cache/agentcut/models/
```

An existing `~/.cache/clipsmith/models/` directory is reused for older installations.
The default is multilingual with language auto-detection; keep it that way for
non-English recordings, since `.en` models are English-only and produce plausible
garbage on anything else. If the default model fails to load — older whisper.cpp builds
report `unknown tensor` — the run falls back to `small` on its own and says so in the
log; set `AGENTCUT_WHISPER_MODEL=small` to skip the failed attempt, or update whisper.cpp.

URL downloads hand `yt-dlp` the project's vendored FFmpeg (`--ffmpeg-location`), so no
system FFmpeg is needed for the merge. The format string prefers H.264 (`avc1`) video
with m4a audio up to `AGENTCUT_MAX_HEIGHT`, falling back to the best available: the merge
is then a plain remux, and every later step decodes it far faster than AV1.

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
| `AGENTCUT_ROOT` | detected checkout | Internal root override; normally leave unset |
| `AGENTCUT_WHISPER_MODEL` | `large-v3-turbo` | Transcription model; `small` is the automatic fallback when it will not load |
| `AGENTCUT_WHISPER_PROMPT` | unset | Replaces the recogniser's vocabulary hint (by default the glossary's terms). Must be in the spoken language |
| `AGENTCUT_TRANSCRIPT_POLISH` | on | `0` skips the agent proofreading pass over doubtful segments |
| `AGENTCUT_TRANSCRIBE_ON_IMPORT` | unset | `audio`, `always` or `off`; overrides the stored workspace and project setting for newly imported media |
| `AGENTCUT_MAX_HEIGHT` | `720` | Maximum requested URL download height |
| `AGENTCUT_AGENT_SHELL` | unset | Set to `1` to give the clipping agent `ffprobe`/`ffmpeg` (a shell) back |
| `AGENTCUT_OUTPUT_FRAMES` | on | `0` or `off` makes agent turns see source frames instead of rendered output frames |
| `AGENTCUT_OUTPUT_FRAMES_CADENCE` | `2` | Seconds between rendered frames shown to the agent |
| `AGENTCUT_OUTPUT_FRAMES_MAX` | `32` | Most rendered frames per turn; past that the cadence widens |
| `AGENTCUT_OUTPUT_FRAMES_MS` | `40000` | Wall-clock budget for rendering those frames; what rendered is kept |
| `AGENTCUT_CLAUDE_BIN`, `AGENTCUT_CODEX_BIN`, `AGENTCUT_CURSOR_BIN`, `AGENTCUT_OPENCODE_BIN` | `PATH` lookup | Path to a harness binary that is not on `PATH` |
| `AGENTCUT_PEXELS_KEY`, `AGENTCUT_UNSPLASH_KEY` | unset | Stock photo providers. A key saved in Settings is stored write-only in SQLite and wins over the variable |
| `AGENTCUT_GOOGLE_CSE_KEY`, `AGENTCUT_GOOGLE_CSE_CX` | unset | Google Programmable Search key and engine id for web image search; same precedence |
| `AGENTCUT_GOOGLE_CSE_RIGHTS` | `cc_publicdomain\|cc_attribute\|cc_sharealike` | Licence filter for Google image results; `any` searches everything |
| `CHAT_DB_PATH` | unset | The stream chat's `chat.db` for opening comments. A path saved with `chat.setSource` wins, then this, then the unified chat's default location |
| `AGENTCUT_DRY_RUN` | unset | `1` makes `scripts/agentcut.mjs` print the command it would run instead of running it |

Sign-in detection also honours the CLIs' own variables: `CLAUDE_CONFIG_DIR`, `CODEX_HOME`
and `XDG_DATA_HOME`. Provider keys are never copied into the environment of a spawned
harness and are never returned to a page or an agent; the Settings page shows only that a
key is set and where it came from.

Prefer an absolute workspace path. Changing the workspace switches which projects
you see; it does not migrate existing projects. Do not run UI and CLI with different
workspace settings if they are meant to edit the same projects.

## Workspace and backups

The default layout includes:

```text
workspace/
  agentcut.db                 # authoritative project state
  library/                    # reusable assets shared by every project (keyed by content)
  templates/                  # your own templates, beside the built-in ones
  rules/                      # workspace-level rules
  packs/                      # installed packs
  exports/                    # exported packs (exports/packs/<id>/)
  cache/                      # thumbnails and brand-logo lookups
  bin/                        # symlinks to the vendored ffmpeg and ffprobe, for yt-dlp
  onboarding-runs/            # the setup interview's agent runs
  projects/
    PROJECT_ID/
      media/                 # imported footage, copied so moving the original breaks nothing
      assets/                # project assets
      transcripts/           # one transcript cache per imported source
      cache/                 # loudness envelopes (peaks) and other derived data
      clips/                 # rendered MP4s
      output-frames/         # rendered stills an agent turn was shown
      editor-runs/           # agent request/response records, one directory per turn
      plan-runs/, rule-runs/, review-runs/   # the other agent runs, same shape
      rules/                 # project-level rules
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
| No agent CLI found | Check `claude --version`, `codex --version`, `cursor-agent --version` or `opencode --version`; restart the app with the correct `PATH`, or point `AGENTCUT_<HARNESS>_BIN` at the binary. |
| "macOS is blocking this folder" when choosing a file | Give the terminal or editor that runs the server Full Disk Access (System Settings → Privacy & Security), then restart it. |
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
