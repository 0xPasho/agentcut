# agentcut

Long video in, vertical short clips out — cut by the coding agent you already pay for.

Runs entirely on your machine. No API keys, no upload, no per-minute billing: it shells
out to Claude Code or Codex using your existing session.

## What makes it different

The agent is the **editor**, not a hardcoded pipeline. It reads the transcript, checks
audio peaks and scene cuts, **looks at sampled frames**, and writes an edit decision list:
clip boundaries, crop or split-screen layout, caption style, punch-ins, silence cuts.

The renderer then replays that EDL deterministically — so re-renders are instant and
reproducible, tweaks don't need another agent run, and a bad clip is one readable file
you can inspect.

## Requirements

- Node 22+ (uses the built-in `node:sqlite`)
- [Claude Code](https://claude.com/claude-code) or Codex, logged in
- `whisper-cpp` for transcription — `brew install whisper.cpp`
- `yt-dlp` for URL input — `brew install yt-dlp`

ffmpeg ships with the project, so a broken system ffmpeg doesn't matter.

## Use it

```bash
pnpm install
pnpm dev          # http://localhost:3000
```

Drop a video, paste a YouTube URL, or point at a file on disk. Or run it headless:

```bash
npx tsx scripts/clip.ts video.mp4 --clips 6 --brief "focus on the pricing discussion"
npx tsx scripts/render.ts <projectId>
```

Both paths write to the same project, so a CLI run shows up in the UI.

## Layouts

- **Split-screen** for screen-share streams: webcam on top, the part of the screen the
  clip is about underneath. The agent locates both by reading frames.
- **Crop** with keyframes for talking heads.

## Config

| Variable | Default | |
|---|---|---|
| `AGENTCUT_WHISPER_MODEL` | `small` | Multilingual. `.en` models return confident nonsense on other languages. |
| `AGENTCUT_MAX_HEIGHT` | `720` | Download cap for URLs. |
| `AGENTCUT_AGENT_SHELL` | unset | `1` grants the agent `ffprobe`/`ffmpeg`. |
| `AGENTCUT_WORKSPACE` | `./workspace` | Where media and the database live. |

## Security

The agent reads transcripts of third-party video — attacker-controlled text. It runs with
`Bash`, `WebFetch` and `WebSearch` **denied**, confined to the project's workspace
directory. See [SPEC.md](./SPEC.md) for the threat model and why an allowlist alone is
not enough.

## License

MIT. Note that [Remotion](https://remotion.dev/license), used for rendering, requires a
paid license for companies above a certain size.
