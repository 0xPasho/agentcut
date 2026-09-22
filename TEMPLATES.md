# Templates

A template is the *structure* of a video: where the hook sits, how the captions read,
how often a picture is allowed to interrupt, what the rhythm is. It carries no content.
Applying one to a video turns its transcript into captions, dead-air cuts, punch-ins,
a hook layer and a set of pictures, through the same operations a human uses by hand.

Templates are plain JSON documents. Built-ins ship with the app; anything in
`<workspace>/templates/*.json` is a user template, and a user template overrides a
built-in with the same `id`. Writing one needs no code.

## One editor, two interfaces

The human panel (**Video → Plan and templates** in the editor header) and the agent call the
same two project tools:

| Tool | Behaviour |
| --- | --- |
| `templates.list` | Every template on this machine, built-in and user, with full settings |
| `templates.get` | One template by id |
| `templates.schema` | The JSON Schema a template document is written against |
| `templates.suggest` | Measures the material and ranks every template, with the reasons behind each score |
| `templates.save` | Create or replace a user template. Takes a whole document, or `from` an existing template with `id`, `name` and `overrides` to save a variation |
| `templates.delete` | Remove a user template. Built-ins cannot be deleted, only overridden |
| `template.plan` | Dry run. Returns the sentences, which get a picture, and what it would look for. Writes nothing, needs no network |
| `template.apply` | Commits that plan through `project.edit`, taking `expectedRevision` |

`template.apply` produces `EditorOperation[]` and submits them through the shared
operation engine and revision store. It has no private mutation path, so every edit it
makes is an ordinary edit: visible on the timeline, editable by hand, undoable, and
identical whether a person pressed **Apply** or an agent called the tool. The agent also
receives `templates.json` in its run directory, so it knows which templates exist before
it decides which one the material wants.

## Inheritance, looks, brand, bookends, aspects

- **`extends`**: `{"id":"quiet-explainer","extends":"explainer-broll","name":"Quiet explainer","captions":{"uppercase":false}}`
  is the parent with one field changed. Stored as that sparse patch, so a change to the
  parent flows through. Chains are fine; a cycle or a missing parent hides only the
  templates involved.
- **`captionLook`** names a caption look (`templates.looks`: bold-yellow, clean-white,
  boxed-dark, pop, stream-pop, minimal). The look supplies what the template's own `captions` do
  not set.
- **`brand`** is a brand kit: `palette` (primary → caption highlight, text → caption
  colour, background), `fonts.captions`, `logo` (asset or slot, lent to the watermark when
  it has none). A glossary subject can carry a `brand` too; a project whose plan names
  that subject inherits it when the plan is applied.
- **The body**: a bookend is a composition of its own, so the layers a template holds
  across the video hold across what is *between* the bookends — the hook, the cards and
  the watermark start when an intro ends and stop where an end card begins, and
  `atFraction: 1` means the last frame before that card rather than a call to action on
  top of it. The music bed is the exception at one end: it plays from the first frame,
  under an intro like any other shot, and still stops at the end card, which arrives
  with its own sound.
- **`intro` / `outro`**: a picture held full-frame for `seconds` at the start or the end,
  on the main track, from an `image` slot or an asset id — or a whole video played to its
  end, which is what a channel's end card is. The intro shifts every shot after it; both
  are ordinary items and converge on re-apply. Point `slot` at a `video` slot to keep the
  template free of asset ids.
- **`variants`**: per-aspect overrides keyed `9:16`, `4:5`, `1:1`, `16:9`, merged when the
  template is applied to a video of that shape. `sequence.derive` copies a video into
  another aspect as its own editable sequence (crops recentred, plan carried, status
  pending, linked through `plan.reasons.derivedFrom`).
- **Sound**: a template can carry its own sound design. `rhythm.punch.sfx` plays a sound on
  every punch-in; `sound.transitions` plays one on every cut between shots; `sound.opener`
  plays one on the first frame; `music` is the bed. Each takes `enabled`, then a `slot`, an
  `assetId` or a `query` — a free-licence audio search, run once and downloaded into the
  project like a picture. A search that finds nothing, or a machine with no network, leaves
  that sound out and applies the rest of the template anyway.
  `starter` names one of the sounds that ship with the app — whoosh, ding, pop, impact,
  riser, click, swipe, sparkle — which is how a built-in template can arrive with its sound
  already working: an asset id is generated per machine and cannot be written into a shipped
  document. A starter sound the owner deleted is simply not played.
  **`sound.mode: "off"` silences all of it in one field**, so sound is something a video can
  refuse whole rather than unpick edit by edit. Transitions and the opener are placed as
  ordinary sfx layers, authored by the template, so re-applying replaces them and a person
  can move, level or delete them by hand.
- **Video bookends**: `intro` / `outro` may name a library video; it is added as project media
  and placed as a shot (played whole), marked as the template's through the shot's `reason`.
- **Preview**: `templates.preview` and `GET /api/templates/<id>/preview?aspect=9:16` return
  a schematic SVG of the layout — hook, caption band in the template's colours, picture
  plate, watermark corner, cards, bookends. A schematic, not a render.

## Framing: the screen and the person

A stream is a screen with a person in the corner of it. A single crop of that frame is
mostly wallpaper with the speaker sliced off at an edge, so `layout` stacks the two
rectangles that matter instead:

```json
"layout": {
  "mode": "split",
  "screen": { "x": 0, "y": 0, "w": 1, "h": 1 },
  "camera": { "x": 0.69, "y": 0.72, "w": 0.31, "h": 0.28 },
  "cameraPct": 32,
  "cameraPosition": "bottom"
}
```

- Both rectangles are **shares of the source frame**, not pixels, because a template
  outlives the recording it was written on: the same scene comes out 1920x1080 on one
  machine and 1728x1116 on another, and pixels would frame the wrong thing on the second.
- `cameraPct` is the share of output height the person gets; `cameraPosition` says which
  half they are in. **The push-in follows them** — zooming the screen instead makes the
  shared content lurch on every emphasis beat.
- Each rectangle is cropped to fill its half, so their aspect ratios need not match, and
  a wide screen loses its edges rather than its middle. Narrow `screen` to the window the
  clip is actually about when the whole desktop is too much.
- `mode` is `source` (leave each shot's own framing alone — what every template did
  before this and what a captions-and-cuts template should keep doing), `crop` (centre
  crop, for a talking head) or `split`.
- The camera rectangle has no sane default: nothing can read it off a document. A split
  without one is refused, and the dry run says so before anything is applied.
- The framing is written onto every shot that has footage, including one with no
  transcript, and only when it differs from what is already there — so re-applying
  converges and a project that was already framed this way is not touched. A template
  whose `mode` is `source` leaves a hand-made split exactly as it is.
- `template.plan` reports `framing`: the mode, which half the camera is in, and where
  the seam falls as a share of height. Two more mistakes are called out there, because
  both are invisible until the first render: captions that start above the seam and run
  past it, and a screen rectangle wide enough that the webcam shows through it — the
  speaker then appears twice, small in the screen pane and large in their own. Stop the
  screen where the camera starts, which is what the built-in does.

## Choosing one

Neither a person opening the panel nor an agent reading `templates.json` can see the
shape of the material at a glance. `templates.suggest` measures it — how many sentences
there are, what share of them name a company, what share name anything at all, whether
there is footage, whether a pool is filled — and scores every template against its own
settings, so a template written this morning is ranked on the same evidence as a built-in.

How many pictures a suggestion promises is not estimated: it is what the planner says,
because the planner is what will actually run. A second model of the same rule drifts
from it silently, and did — it predicted pictures for a template whose sources could not
place one. The planner's own warnings are carried through as reasons for the same reason.

Each suggestion carries its reasons, because a ranking you cannot argue with is not
useful. It also catches a mistake that is invisible in a template document: resolution
stops at the first source that answers, and a frame over real footage always answers, so
`["frame", "brand"]` never shows a logo however many companies the script names. A
template with an unfilled required slot scores zero rather than disappearing, and says
which slot.

**Which one suits this video?** in the panel runs exactly this and selects what you pick.

## Applying and re-applying

```json
{
  "tool": "template.apply",
  "templateId": "explainer-broll",
  "sequenceId": "s_1a2b3c4d",
  "expectedRevision": 7,
  "hookText": "Why ranking changed",
  "slots": { "screenshots": { "folder": "~/Desktop/chat-shots" } },
  "overrides": { "images": { "density": 0.6, "sources": ["brand", "web"] } }
}
```

- `sequenceId` names the video. `clipId` names a generated clip, which is promoted in
  place first, keeping its id and edits. With exactly one video in the project, either
  may be omitted; with several, naming one is required.
- `overrides` is a field-level patch over the stored template. Objects merge, arrays and
  scalars replace, and `id` cannot be overridden — an override is a variation of a
  template, not a new one. Saving a variation is `templates.save`.
- `slots` fills the template's named inputs. An `imagePool` slot takes
  `{"folder": "..."}` (every image in it, in filename order) or `{"assetIds": [...]}`.

A clip cut out of a long recording arrives with a draft on it: the selection agent's own
hook title, its dead-air cuts, its push-ins, marked `by: "select"`. A template replaces
that draft along with its own previous output, because it is the same job done by a pass
that had not been told what the video should look like. Keeping it put a second title
over the hook and multiplied two overlapping push-ins into a zoom neither asked for.
A hand edit is still a hand edit and survives both.

Every edit a template writes carries `by: "template:<id>"`. Re-applying removes only
edits with that marker and only canvas layers whose every edit carries it *and* whose
placement is still what the template gave them. A title you placed by hand survives; so
does a template layer you have since edited; and so does one you have moved, resized,
rotated, faded or retimed — a nudged watermark stays where you put it, and the template
does not put a second one back in the corner beside it. This is why changing a
template's settings is a matter of applying it again, not of undoing first.

## When a picture appears

This is the part that decides whether a video looks edited or looks like a slideshow.

A sentence earns a picture by **naming something**. Salience scores a sentence on
what it points at: a recognised brand is the strongest signal, a proper name next, a
number supporting evidence. A sentence that only explains scores near zero and is
deliberately left bare.

Candidates are then taken best-first and filtered by spacing — `minSentenceGap` (1 means
never two in a row) and `minGapSec` — up to `density × sentences`, capped by `maxCount`.
Picking the best sentences first and enforcing the gaps second is what produces
"roughly every other sentence, where it helps" rather than a metronome.

A run of ordinary words that happens to spell a brand when glued together is not that
brand: "next door" is not Nextdoor, and a two-word phrase can only match a name written
as two words. A capital at the start of a sentence is grammar rather than a name, so
"Go to the store" and "Meta question" name no company either.

### When capitalisation cannot be trusted

Names are read from capitalisation, and auto-captions arrive lowercase and
unpunctuated while some imports arrive in block capitals. In both, a capital letter
proves nothing, so the planner stops guessing from it: proper-name extraction is
switched off entirely and names come from the brand index alone, matched without
regard to case. A single lowercase word then has to be at least four characters and
not an ordinary English word, because Simple Icons lists "Go", "Arc", "Box" and
"Spring" as brands and in running text those are almost never the company. Two-word
names are unambiguous and are always matched. The plan says so in its warnings rather
than quietly finding less.

Sentence boundaries survive this: with no full stops, the splitter falls back to the
pause between sentences, which real speech always has.

The brand index is fetched once and cached for thirty days. Offline, planning runs on
the last cached index, or on the seeded names if there has never been one, and does not
try the network again for five minutes — a three-hundred-sentence transcript is never
three hundred connection timeouts.

### When a subject is not needed

The salience floor exists to stop the tool searching for a picture of something the
sentence never named. Two sources have nothing to search for: a still cut from this
shot's own footage, and the next picture out of a folder you supplied. Both need a
*moment*, not a name. When either is available, the floor and the subject requirement
do not apply, and spacing and density alone decide where the pictures land.

This is what makes a walkthrough work. "The settings panel is where the whole thing
starts" names nothing a search engine could find, and under a search-based source it
correctly earns no picture and the plan says so — but `product-demo` is showing you the
panel that is already on screen, and that sentence is exactly where it should.

`images.mode` chooses the policy:

| Mode | Behaviour |
| --- | --- |
| `auto` | Only sentences scoring at least `minSalience`. The default, and the one that looks right |
| `alternate` | Every other eligible sentence regardless of what it says |
| `every` | Every sentence that can be illustrated at all |
| `off` | No pictures |

A shot with no transcript takes pictures only from a filled pool, spaced evenly — a
folder of screenshots over silent footage is its own video format.

## Where a picture comes from

`images.sources` is walked in order and stops at the first source that answers. A beat
that finds nothing is left bare rather than filled with something wrong.

| Source | Resolves to |
| --- | --- |
| `slot` / `slot:<id>` | The next unused picture from a filled `imagePool` slot |
| `brand` | The official mark, when the subject is a brand name |
| `project` | An image already in this project or the library whose name or tags name the subject |
| `frame` | A still captured from the shot's own footage at that moment |
| `web` / `web:<provider>` | Image search, optionally restricted to one provider |

Putting `brand` ahead of `web` is what makes "Google" the Google mark instead of a
photograph of an office; putting `slot` ahead of everything is what makes your
screenshots win over a stock photo. With `pairBrands`, a sentence naming two companies
gets both marks side by side.

A folder pool imports only the pictures it hands out: two hundred screenshots the plan
consumes six of cost six copies. One brand named in twenty sentences is fetched once.
`project` matches whole words only — "AI" does not find `train-station.jpg`, and "Go"
does not find `logo.png`.

### When a beat comes back empty

A beat that finds nothing is left bare rather than filled with something wrong, and for
four iterations that was indistinguishable from a beat that was never planned. It is not
any more: `template.apply` returns every dropped beat with the sentence that wanted the
picture and what each source said about it —

```json
{ "sentence": "Google changed how ranking works this year.", "query": "Google",
  "attempts": [{ "source": "slot", "outcome": "empty", "detail": "the folder ran out of pictures" }] }
```

`skipped` means the source had nothing to work with (the sentence names no company;
the shot has no footage), `empty` means it looked and found nothing, and `failed` means
it broke — an expired API key and a query nothing matches are not the same problem, and
used to look the same. The panel lists them under the apply notice. `template.plan` warns
in advance about the one shortfall it can prove offline: more beats than supplied pictures
when a pool is the only source. It counts the folder rather than assuming it is full —
reading a directory is free and changes nothing, and guessing instead means that warning
can never fire on the input people actually give. A folder it cannot read counts as no
pictures and says so. The dry run, the suggestion and the apply path all size pools
through the same count, and applying plans on that count *before* importing anything, so a
request that is going to be refused is refused before a folder of pictures has been copied
in on its behalf.

A provider that errors is reported and logged rather than folded into "no results", so a
rejected key is visible instead of looking like an unlucky query.

### Image providers

`assets.providers` reports what this machine has. `assets.search` takes an optional
`providers` list.

| Provider | Key | Notes |
| --- | --- | --- |
| `brand` | none | ~3,400 company and product marks from Simple Icons (CC0), cached in the workspace. Answers only when the query *is* a brand name. A mark whose own colour is white is drawn dark, so it reads on the plate |
| `commons` | none | Wikimedia Commons. Free-licence photographs and diagrams of named things |
| `openverse` | none | Creative Commons aggregator |
| `pexels` | `AGENTCUT_PEXELS_KEY` | Stock photography |
| `unsplash` | `AGENTCUT_UNSPLASH_KEY` | Stock photography |
| `google` | `AGENTCUT_GOOGLE_CSE_KEY` + `AGENTCUT_GOOGLE_CSE_CX` | Google Programmable Search. Restricted to Creative Commons rights by default; results still carry no verified licence and are labelled as such |

Keyed providers return nothing at all until their key is set, so nothing breaks without
one — but a provider asked for *by name* that cannot answer, whether the name is a typo
or the key is missing, is reported as a failure that says so, never as "no picture
matched". A download that turns out not to be an image (a hotlink-protection page served
as 200) is refused rather than saved under a picture's name. Credits are stored with
each adopted asset and reported by `template.apply`.

## The template document

```json
{
  "id": "my-explainer",
  "name": "My explainer",
  "description": "What this look is for",
  "output": { "width": 1080, "height": 1920, "fps": 30 },
  "captions": { "preset": "karaoke", "positionY": 0.7, "uppercase": true },
  "hook":   { "mode": "sticky", "position": "top", "style": "card", "maxWords": 9 },
  "images": { "mode": "auto", "density": 0.45, "minSentenceGap": 1, "durationSec": 2.6,
              "y": 0.32, "widthPct": 76, "style": "auto",
              "sources": ["slot", "brand", "project", "web"] },
  "rhythm": { "silence": { "enabled": true, "minGapSec": 0.45 },
              "redundancy": { "enabled": true, "minWords": 2, "maxGapSec": 1.5 },
              "punch":   { "enabled": true, "perMinute": 4 },
              "emphasis":{ "enabled": true, "targets": ["numbers", "brands"] } },
  "cards":  [{ "id": "cta", "atFraction": 1, "text": "Follow for more", "seconds": 2 }],
  "slots":  [{ "id": "screenshots", "label": "Screenshots folder", "kind": "imagePool" }]
}
```

- `captions` is a patch: omitted fields keep the video's current caption settings. Any
  preset applies — `karaoke` lights the spoken word, `popline` shows one word at a time,
  `boxed` sets the line on a plate, `none` turns captions off. With `popline`, every word
  on screen *is* the spoken word, so `highlight` paints the whole video: leave it equal to
  `color` and let `rhythm.emphasis` carry the accent, which is what `stream-pop` does.
  An emphasised word is drawn in the colour its own emphasis beat asks for
  (`rhythm.emphasis.color`), not in the caption highlight.
- `rhythm.redundancy` cuts a phrase said twice in a row — the false start a stream is full
  of, "y entonces yo… y entonces yo creo que". There is no silence in it, so the dead-air
  pass cannot see it; what marks it is the repetition. The stumble goes and the run that
  continues the sentence stays. `minWords` is 2 because a single repeated word is as often
  emphasis ("muy, muy bueno") as a stutter, and `maxGapSec` is what separates a stumble
  from saying something again on purpose.
- `hook.mode` is `sticky` (its own layer, the whole video), `intro` (`seconds` only) or `off`.
  Its text comes from `hookText`, then the template's own `hook.text`, then a hook written
  on any shot, then a footage shot's title — never a canvas layer's title, whatever order
  the layers happen to sit in. `{{hook}}`, `{{title}}` and `{{slot:<id>}}` are substituted.
- `hook.maxWords` is the length a card holds, and it is no longer a knife. A hook is
  written in sentences — by a person, or by the agent that picked the clip — so a line
  over the limit is cut where a sentence lets go: **the question in it**, if it has one,
  because the rest is the lead-up and the question is what hooks; otherwise the last
  clause boundary that fits, unless that gives back almost nothing; and a line only a
  little over is kept whole, because a card holds it and mangling it costs more than the
  length. A word-count cut with an ellipsis is the last resort. The dry run reports
  `hook.shortened` and says what it will read instead, so the line can be rewritten
  rather than discovered in the export.
- `cards` pin a title card to a fraction of the finished timeline. Keep them off
  `position: "bottom"` while captions are on — that is the caption band, and a card
  there hides the line being spoken under it. The dry run warns when a template does. A card is placed by
  its start until that would push its end past the last frame, from which point it backs
  off — so `atFraction: 1` means "ends on the last frame", not "starts after it". A card
  whose text is an unfilled `{{slot:…}}` is not a blank card: it is simply not there.
- `images.style` is `auto` (logo plate for a brand mark, photo card otherwise), `card`,
  `plain` or `logo`. A monochrome brand mark needs the plate to read on footage.
- `heightPct` caps the share of frame height an overlay may take, and the picture keeps
  its own aspect ratio inside both bounds. A width alone is enough for a photograph,
  which is wider than it is tall; a phone screenshot is the opposite, and at 86% of a
  1080px frame a 900x1900 crop is 1961px high in a 1920px frame — it runs off both ends
  and buries the hook. The default leaves room for a hook above and captions below.
- A logo plate uses `logoWidthPct`, not `widthPct`. A mark is a symbol, not a picture:
  at photograph width its white plate swamps the shot and, being square, collides with
  a sticky hook. Two marks side by side each take less again.
- `watermark` holds a mark in a corner for the whole video — a channel logo, a show
  bug. Point `slot` at an `image` slot; leave it empty and there is no mark. It is
  placed as an ordinary image on its own layer, so it can be moved or removed by hand.
  It defaults to a bottom corner: a sticky hook lives at the top, and two things the
  same template placed should not fight for the same corner. The mark is boxed to a
  square of its own width, so a tall wordmark is letterboxed rather than standing out of
  its corner.
- `music` lays a ducked bed across the whole video. Point `slot` at an `audio` slot and
  the bed is whatever the author chose when applying; leave the slot empty and there is
  no bed, which is not an error.
- A slot key that is present but empty — `{}`, a blank path, an empty list — counts as
  unfilled everywhere, rather than reading as supplied and failing later as an empty pool.
- `slots` declare inputs. `imagePool`, `image`, `video`, `audio` and `text` are supported,
  and the Templates panel renders each kind: a folder path for a pool, a line of text for
  `text`, a picker of the project's own assets for `image`, `video` and `audio`.
  `required: true` makes applying fail rather than silently producing less — checked for
  every kind, before anything is imported, so a template that requires an end card never
  produces a video that quietly ends without one.
  A `video` slot is what lets a *shared* template end on **your** card: the document names
  the shape (`"outro": {"enabled": true, "slot": "endcard"}`) and never an asset id, which
  is machine-specific and would travel as a dangling reference. The person applying it, a
  rule's `then.slots`, or a pack that ships the file and remaps its id, supplies the card.

`templates.schema` is the authority for every field and range.

## Headless

```bash
pnpm exec tsx scripts/templates.ts list
pnpm exec tsx scripts/templates.ts show explainer-broll
pnpm exec tsx scripts/templates.ts plan  PROJECT_ID explainer-broll --sequence SEQUENCE_ID
pnpm exec tsx scripts/templates.ts apply PROJECT_ID chat-story --slot screenshots=./shots --hook "The message that ended it"
pnpm exec tsx scripts/templates.ts apply PROJECT_ID story-arc --text turn="But here is what happened" --text cta="Follow for part two"
pnpm exec tsx scripts/templates.ts apply PROJECT_ID brand-explainer --asset logo=a_1234abcd
```

`--slot` fills an image-pool slot from a folder, `--text` a text slot, `--asset` an image or
audio slot with an asset id — every slot kind a template can declare.

The launcher exposes the same commands from any directory, resolving `--slot` folders
against the caller: `node /path/to/agentcut/scripts/agentcut.mjs templates apply …`.
`scripts/edit.ts PROJECT_ID call request.json` reaches every template tool directly.
No web server is required for any of them.

## A shortlist, rather than one template

`plan.templates` is the set of templates a project may be made in. One of them, and
`plan.template` names it; several, and the choice is made per video from that shortlist and
no further. It is a shortlist, not a merge: two caption styles cannot both win.

The home screen writes it — **Multi** in the template picker keeps adding rather than
replacing, and each chosen template sits on the composer's own row — and the editor's
**Video → Plan and templates** shows it as chips: click one to settle it for every video,
or drop it from the list. `templates.suggest` ranks only the shortlist when there is one,
because a shortlist is a decision already made.

## Built-in templates

| Id | For |
| --- | --- |
| `explainer-broll` | Vertical explainer: sticky hook, karaoke captions, a picture where a sentence names something |
| `talking-head` | Captions, dead-air cuts, occasional punch-ins. No pictures |
| `brand-explainer` | Every company named gets its mark, two side by side when a sentence names two |
| `chat-story` | A folder of screenshots told in order, one every couple of sentences, with boxed captions |
| `story-arc` | Gives a story a shape: the hook holds, a card marks the turn, a closing line lands at the end. Both lines are slots you write when you apply it |
| `product-demo` | Illustrates from the footage itself, capturing a still at the moment something is described |
| `fast-cuts` | Short-form at speed: every pause cut, a punch-in with a whoosh on it, a swipe on each cut, a riser on the first frame |
| `quote-card` | One line, centred on a plate. No hook, no pictures, no push-ins — a ding opens it |
| `how-to-steps` | A ding and a push-in on every step, illustrated from your screenshots or from the footage, with a closing recap card |
| `news-brief` | Company marks and lit numbers, captions low, an impact on each cut and a riser to open |
| `music-montage` | Footage with nobody talking: no captions, a bed across the whole thing, a whoosh on every cut. The one that needs no transcript |
| `stream-short` | A short cut from a screen-share stream: the screen on top, the person below, a hook held for the whole video, one word at a time above the seam, and the card you end every video on |

The last five carry a sound design out of the box, built from the sounds that ship with the
app — so they work with no network and nothing to fill in. The first six are silent unless
you give them a music slot, which is deliberate: they were here before sound was, and a
template should not start making noise because the app was updated.

Copy one, change what you want, save it under a new `id` — or override a built-in by
saving a template with its id. Saving a *variation* is `templates.save` with `from`,
which merges through the same `mergeTemplate` an override uses at apply time: saving
these settings and applying them cannot mean different things, and the parts of a
template the panel cannot edit come along rather than reverting to defaults. The **Save these settings as…** field in the editor's
Templates panel does exactly that through `templates.save`.

## Verification

`pnpm test` covers sentence segmentation, salience, cue spacing and density, applying
from both transports, re-application preserving hand edits, capturing stills from the
footage, uncapitalised transcripts, structural cards and their anchoring, the registry
and overrides, the music bed, the corner watermark, provider reporting, and suggestion
ranking, applying to a generated clip, multi-shot videos, a save landing mid-apply, and
that applying the same template twice converges rather than accumulating, and that a
dropped beat names the source that declined and why, and that a logo plate is sized as
a symbol while a photo card keeps photograph width, that an overlay is bounded by height
as well as width, that a bottom card is called out against captions, that brand
matching stays fast across a long transcript, and that a source needing no subject does
not demand one, that every suggestion's picture count equals what the planner plans, and that a saved
variation is field-for-field identical to applying the same overrides, and that a dry
run's predicted shortfall is exactly what applying it produces.

One test sweeps **every** built-in generically: with all its slots filled, each must plan
pictures if it claims to place any (or say why it cannot), produce a hook exactly when its
own settings say so, place every card whose text was supplied, cut dead air exactly when
its own setting says so, and write something real when applied. A new built-in is covered
by it automatically. This is the check `product-demo` would have failed while shipping
unable to illustrate anything.

`product-demo` was rendered on a walkthrough script that names nothing: a still is cut
from the shot's own footage at the moment being described and composited on its card,
with the white border separating it from the footage it came from.

The composition was also checked by rendering full videos in this format at 1080x1920
and reading the exported frames: the hook holds from the first frame to the last, a
correctly sized logo plate sits clear beneath it on the sentences that name a company,
the sentences between them carry captions alone, and the corner mark holds throughout.

A three-shot render confirms the same across real cuts. Either side of a cut the footage
changes while the hook card, the corner mark and the music bed hold without flicker — the
music measured at the same level across every cut — and each shot's own beat fires on its
own sentences, in its own clip-relative time, with the captions switching to that shot's
script.

`chat-story` was rendered the same way with real portrait crops, including full-height
ones: each screenshot sits whole between the hook above it and the boxed captions below,
in folder order, with nothing clipped at either end of the frame.

`story-arc` was rendered with both cards filled: the hook holds at the top, the turn card
sits in the middle of the frame, and the closing card lands in its own band with the last
spoken line still readable beneath it.
`pnpm test:render` also checks the watermark is in its corner over every cut.

Applying to a **generated clip** promotes it in place: the timeline keeps the clip's id,
so existing `/c/<id>` links still open it, and it keeps its footage — which is what
`frame` capture depends on. Resolution deliberately runs against the timeline the
operations will produce rather than the one on disk, because the promotion is not
committed until the batch is.

On a **multi-shot video** each shot is analysed on its own, in its own clip-relative
time, while the hook, cards, watermark and music span the finished timeline once. A
layer the template has nothing to say about — a title someone placed by hand, a shot
with no transcript — is left exactly as it is.

A **save landing between reading the project and committing** rejects the whole batch
with a conflict rather than half-applying it; read the current revision and apply again.

A real Claude Code run through the file tool transport — no shell, no network — read the
project, called `templates.suggest`, explained why `brand-explainer` ranked first on a
script half of whose sentences named a company, dry-ran `template.plan`, and committed
`template.apply`: four brand marks, uppercase karaoke captions, seven dead-air cuts, two
punch-ins and the sticky hook, with the transcript intact. That is the same path the
panel's Apply button takes.

A second run exercised the slot and reporting surface. Given a folder of chat screenshots
and nothing else, it chose `chat-story`, dry-ran it, noticed from the plan that the stock
settings wanted three pictures where the folder held two, widened the spacing so the beats
matched the pictures, applied it with nothing dropped, reported which beat *would* have
gone bare and why, and saved the settings it had arrived at as a template of its own — the
overrides it made and the fields it never touched both intact.
`pnpm test:render` exports a real video and checks the planned pictures appear in folder
order at the planned beats, that the gaps between them stay bare, that the hook layer
survives every cut, and that dead air was removed.
