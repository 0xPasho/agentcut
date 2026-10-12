# Saves and ideas

Decision 157 in [AGENT-FIRST.md](./AGENT-FIRST.md).

Two steps. While browsing, the **AgentCut Capture** extension (`~/Projects/extension-for-videos`)
keeps **saves**: the post or video being looked at, plus a word about it. Later, in
`/saves`, several saves are picked and built into an **idea**, which one or more
harnesses draft into a brief on the board at `/ideas`, until it is started as a project.

## Model (`packages/core/src/modules/ideas/types.ts`)

| Thing | Holds |
|-------|-------|
| `Save` | kind (`page`, `x_post`, `video`, `image`, `selection`, `element`), the item's own URL, a deep link (`anchor`: second of a video, text fragment), the page it was seen on, author/handle, text, metrics, media, the note, a screenshot file, the downloaded video and its status, the ideas it feeds |
| `Idea` | title, note, status, position in its column, linked saves (`idea_saves`), chosen run, project once started |
| `IdeaRun` | one harness drafting one idea: status, last activity line, raw reply, parsed `Brief`, cost |
| `Brief` | title, angle, 3–5 hooks, format (platform, aspect, length), beats (`hook`/`point`/`payoff`/`outro`), script, shots, why it works |

SQLite tables `saves`, `idea_saves`, `ideas`, `idea_runs`. A save's files live in
`workspace/saves/<id>/` (`shot.jpg`, `source.mp4`, `frame-N.jpg`, `transcript.txt`);
run folders in `workspace/ideas/<id>/runs/<run>/`. Deleting an idea leaves its saves.

## Keeping the video

A save of a video (or a post with one) is `pending` until `server/media.ts` downloads it
with `downloadUrl` (yt-dlp, as a project from a link). One at a time; a failure is
written on the save and never blocks the next. A restarted server resumes on the next
read. Sites that need a login (often Instagram) can fail here; the save keeps its
screenshot and text.

## Previewing a save

In `/saves` a click opens the save in a panel beside the list (a dialog inside an idea on
the board — the same `SavePreview`). The circle on a card selects it; once anything is
selected, a click selects too, the way a photo library works. ← → walk the list, Esc
closes. The panel plays the kept video from the second it was saved (with "from the
start"), else the screenshot; shows the note (editable), what the post said, its numbers,
and the transcript — recognised on demand by the local whisper.cpp and cached — and can
open the original, copy the link, start a new idea from the save, add it to an existing
one, try the download again, or delete it.

Rejected: embedding the original post (X, Instagram and TikTok embeds need the network,
break, and sometimes a login; the video and screenshot are already on this computer);
a centered modal in the library (it hides the list being browsed); a page per save
(walking the list would mean navigating).

## Drafting

`developIdea` starts one run per harness, then studies the saved videos once for all of
them: four stills and a transcript from the local whisper.cpp (`transcribeFile`: VAD
first, the whole audio when VAD hears nothing, as with a voice over music), cached beside
the save. Each run folder holds `idea.json`, `references.json` (each save with its
`creatorNote`, screenshot, frames and transcript), the media and a copy of
`preferences.md`. Runs are read-only: `Read`, `Glob`, `Grep`, with `AGENT_SANDBOX_TOOLS`
plus `Write`/`Edit` denied. Stopping goes through `runWithJob` / `cancelJob`; a run left
`running` by a dead server reads as `interrupted`.

The board moves an idea **Inbox → Developing → Ready** by itself; **In production** and
**Done** are the person's. The first brief names an idea whose title was made up.
**Start video** creates an empty project in the brief's aspect through
`/api/projects/assemble` and sends the brief through `/api/projects/<id>/edit`.

## API

| Route | Does |
|-------|------|
| `GET /api/saves?since=&count=1` | the library, or how many since a moment |
| `POST /api/saves` | one save, as the toolbar sends it (screenshot as a data URL) |
| `GET / PATCH / DELETE /api/saves/<id>` | read; `{ note }` or `{ appendNote }`; delete |
| `GET /api/saves/<id>/files/<name>` | screenshot, video, frames |
| `POST /api/saves/<id>/download` | try the video download again |
| `GET / POST /api/saves/<id>/transcript` | the cached transcript (or `null`); recognise it now |
| `GET /api/ideas` / `POST /api/ideas` | the board; build `{ ideaId?, title?, note, saveIds[], refs[], develop? }` |
| `GET / PATCH / DELETE /api/ideas/<id>` | read, edit, delete |
| `POST / DELETE /api/ideas/<id>/develop` | start runs `{ harnesses[], models?, instruction? }`, stop them |
| `DELETE /api/ideas/<id>/saves/<saveId>` | take a save out of an idea |
| `POST /api/dictation?language=auto\|es\|en` | audio body → `{ text }`, local whisper.cpp (`AGENTCUT_DICTATION_MODEL`) |

The extension calls these from its service worker and offscreen document, which are not
bound by CORS.
