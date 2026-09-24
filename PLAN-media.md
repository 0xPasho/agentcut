# Plan — sound library, image library, image search

Historical implementation plan. New media editing work must follow the shared UI/agent
operation and asset-service contract in [EDITOR.md](./EDITOR.md).

Three features that share one substrate: agentcut needs a concept of **assets** it
doesn't currently have. Today the only asset is a frame grabbed from the source, stored
as a bare filename in the project's `assets/` folder. Everything below builds on fixing
that first.

---

## 1. The asset layer (foundation — nothing else works without it)

### Storage

```
workspace/
  library/                 shared across every project
    images/
    audio/
  projects/<id>/
    assets/                clip-specific: captured frames, downloaded search results
```

Two tiers on purpose. A whoosh you use on every clip belongs in the library; a frame
grabbed from minute 47 of one stream does not.

### Database

```sql
CREATE TABLE assets (
  id           TEXT PRIMARY KEY,
  kind         TEXT NOT NULL,        -- image | audio | video
  scope        TEXT NOT NULL,        -- library | project
  project_id   TEXT,                 -- null for library
  path         TEXT NOT NULL,        -- relative to WORKSPACE
  name         TEXT NOT NULL,
  tags         TEXT,                 -- comma separated, for filtering
  source       TEXT,                 -- capture | upload | openverse | wikimedia | ...
  source_url   TEXT,
  license      TEXT,                 -- CC0, CC-BY-4.0, PDM, proprietary…
  attribution  TEXT,                 -- pre-rendered credit line
  width        INTEGER,
  height       INTEGER,
  duration_sec REAL,                 -- audio/video
  created_at   INTEGER NOT NULL
);
```

`license` and `attribution` are not optional columns. These clips get published; a CC-BY
image with no credit line is a licence breach, and the only moment we can capture the
credit is at download.

### EDL change

`ImageEdit.src` becomes an **asset id**, not a filename. Existing EDLs keep working:
if `src` doesn't resolve as an id, fall back to treating it as a filename in the
project's `assets/`.

---

## 2. Audio

### New edit types

```ts
SfxEdit   = { type: "sfx",   t, d, asset, gain }            // one-shot, tied to a beat
MusicEdit = { type: "music", t, d, asset, gain, duck, loop } // bed under the whole clip
```

Both authored in **clip-relative source time**, like every other edit, and mapped through
the existing time map. One rule for the whole EDL is worth more than a per-type
optimisation — silence cuts already shift everything else, and a second convention is how
bugs get in.

### Ducking

`duck: true` lowers the music under speech. We already have word-level timestamps, so the
envelope is computed, not guessed: full gain in gaps, `gain * 0.25` while words are
sounding, with ~150ms ramps. No audio analysis needed.

### Renderer

Remotion `<Audio src volume>` inside a `<Sequence>`, volume as a frame callback for the
ducking envelope. The workspace file server already covers `library/`, so both the render
and the browser Player resolve the same URLs.

### Where the sounds come from

No third-party audio ships — shipping someone else's sound effects means shipping their
licences. What does ship is eight synthesised starter sounds (whoosh, ding, pop, impact,
riser, click, swipe, sparkle; made by `scripts/make-sfx.mjs`, so they carry no licence),
installed into the library on first read by `installStarterSounds` in
`src/modules/media/server/assets.ts`. A shipped template therefore names a starter
(`sound.*.starter`), never an asset id — ids are per machine.

- **Drop-in folder** (default): anything in `library/audio/` is scanned and registered.
  Works offline, no key, user's own licences.
- **Freesound** (optional): good CC library, but needs an API key and OAuth for full-
  quality downloads. Behind `FREESOUND_API_KEY`, off by default. **Not built.** Sound search
  as built is Openverse audio (`src/modules/media/server/search/audio.ts`), no key, held to
  the same licence and relevance filters as pictures.

---

## 3. Image search

### The security constraint that shapes this

The agent runs with `WebFetch` and `WebSearch` **denied**, because it reads transcripts of
third-party video and that text is attacker-controlled. Giving it network access would
reopen exactly the exfiltration path we closed.

So the agent never searches. This is a recorded decision — see the Decided table in
[AGENT-FIRST.md](./AGENT-FIRST.md): the agent says *what* to show; deterministic host code
decides where it comes from, downloads it and records the licence; the agent has no
network. Instead:

```
agent emits:   { "type": "image", "query": "proxmox web interface", "t": 8, "d": 3 }
                              ↓
resolver (deterministic, ours):  search → pick → download → record licence
                              ↓
EDL rewritten: { "type": "image", "asset": "a_9f2…", "t": 8, "d": 3 }
```

The agent describes *what it wants to show*. Our code decides *where it comes from*. The
agent stays sandboxed, attribution is captured automatically, and the user can swap the
result in the editor.

### Providers

| Provider | Key | Licences | Good for |
|---|---|---|---|
| **Openverse** | none | CC / public domain | general subjects, the sane default |
| **Wikimedia Commons** | none | CC / PD | logos, products, places, people — concrete things |
| Pexels / Unsplash | yes | permissive, no attribution required | polished stock photography |

Openverse and Wikimedia need no key, which keeps the zero-key promise intact. A provider
interface means Pexels drops in for anyone who wants it.

### The live rules, as built

- **Licence filter** (`licenceAllowed` in `src/modules/media/server/search/types.ts`).
  Accepted: CC0, public domain / PDM, CC-BY, CC-BY-SA. Rejected: NC, ND, and GPL/AGPL/LGPL —
  software licences that turn up on Commons for screenshots and carry copyleft obligations
  that make no sense on a video overlay.
- **Relevance filter** (`scoreTitle`). The result's title must contain the query's words;
  a hit is offered only when it carries at least half of them (a third for sound, whose
  titles are shorter). "git worktree" once returned a Mitel phone; a wrong image is worse
  than none.
- **Search only for nameable things.** The selection prompt allows `query` only for a thing
  that exists and has a name — a product, a company, a place, a person, a piece of software,
  an interface. Abstract concepts are forbidden. The resolver may answer "nothing"
  (`resolveQueryDetailed` returns `null`) and the overlay is dropped rather than shown wrong.
- **The first source is the stream itself.** A frame at the moment described, proposed only
  from frames the agent actually read in `frames/`, and only when the thing is not already
  visible in the clip. Web search is the fallback, never the default.
- A query that is exactly a brand name resolves to that brand's own logo (Simple Icons,
  CC0) on a white plate rather than a photograph.

### Caching

Search results cache by `(provider, query)` for a day; downloads are content-hashed so the
same image fetched twice is stored once.

---

## 4. UI

**Library page** (`/library`) — tabs for Images and Audio. Grid, upload, tag filter,
delete. Each row shows its licence; assets that need attribution are flagged. As built,
the Library tab of the media browser holds images, audio *and video* — pack bookends and
rule-slot cards register as library video — and the kind filter is Video / Images / Audio.

**In the clip editor** — the Overlays tab gains:
- *From this stream* (what exists today)
- *From library* — picker
- *Search the web* — query field, result grid, click to add

**Attribution export** — a per-project `CREDITS.txt` next to the rendered clips, listing
every asset that requires a credit line. Also offered as a caption block to paste into a
TikTok description.

---

## 5. Order of work

1. Asset layer: table, library dirs, registration, `/api/assets`, migrate `ImageEdit.src`
2. Library page + upload + drop-in scanning
3. Audio: `sfx`/`music` edits, Remotion `<Audio>`, ducking envelope, editor controls
4. Image search: provider interface, Openverse + Wikimedia, resolver, caching
5. Agent: teach it `query` in the prompt; resolver rewrites it post-run
6. Attribution: `CREDITS.txt`, licence badges in the UI

Steps 1–3 are self-contained and low-risk. Step 4 is where the real unknowns are
(provider result quality for Spanish-language technical subjects is unproven).

---

## 6. Risks worth naming

- **Search quality is the whole feature.** If Openverse returns nothing useful for
  "proxmox web interface", the feature is decorative. Worth testing against real queries
  from the existing 40 clips before building the UI around it.
- **Frames from the stream are still often the better answer** — free, on-topic, no
  licence question. Web search should be the fallback, not the default.
- **Audio without ducking sounds amateur**, so the envelope is not a nice-to-have.
- **Third-party bundled audio is a licensing trap.** The drop-in folder and the synthesised
  starters avoid it entirely.
