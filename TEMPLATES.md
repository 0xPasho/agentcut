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
| `templates.suggest` | Measures the material and ranks every template, with the reasons behind each score. One reason is never scored: on a wide frame — the shape a screen recording has — a template that places pictures says how many would cover what is on it while they show. Whether that matters is the author's call, and the shape of the frame does not prove what is in it. Measuring flatness to tell a screen share from a camera was tried and dropped: on real footage the camera half of the frame reads *flatter* than the screen half, because a person against a wall has fewer edges than a code editor |
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

  `fontSizePct` is the size a look **asks** for, not always the size it gets. A caption
  line wraps between its words, so a word wider than the band has nowhere to go: it runs
  off both edges of the frame with its ends cut off by the picture. Real transcripts
  produce them — `internacionalización` is twenty letters, a spoken URL is thirty-two, and
  a Japanese phrase arrives as one token — and at 5.4% of 1920 a twenty-letter word is
  wider than 86% of 1080. The line that contains one is drawn smaller instead, by enough
  to fit and no more, so one word at a time stays one word on one line rather than two
  rows of letters reaching down onto the speaker's face. The width is estimated from the
  characters rather than measured, because the preview, the export and a test have to
  agree and measuring depends on a font having finished loading. Past the point where
  shrinking would make it unreadable the word wraps inside itself instead. The same
  applies to a hook card. `style.audit` checked the outer 6% of the caption band for a
  while and no longer does: reading a strip against the source compares two resamplings,
  and on a screen recording full of small text two strips of the same frame land twenty
  of 255 apart with nothing drawn on either. It failed on "definitivamente" — the
  extracted band shows it running from x 140 to 930 of 1080 — and passed a fifty-two
  letter word. It also had nothing left to catch, because a line that cannot be shrunk
  into its band wraps inside itself instead of reaching the edge. The render test holds
  that property, on footage where ink is not a chat window.
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
  A video bookend also arrives at the **loudness of the video it is stuck on**. A card is
  mixed once, for itself, and the clip it ends is mixed by whatever was happening that
  day: a real end card measured five LUFS above a real stream clip, which is a step
  everyone hears. Both are measured — integrated loudness, not mean level, because a
  speech clip is half pauses and a sting is continuous — and the card is placed with the
  volume that meets the video. `level: "as-is"` plays it exactly as mixed, and a
  measurement that fails leaves it alone.
- **`variants`**: per-aspect overrides keyed `9:16`, `4:5`, `1:1`, `16:9`, merged when the
  template is applied to a video of that shape. `sequence.derive` copies a video into
  another aspect as its own editable sequence (crops recentred, plan carried, status
  pending, linked through `plan.reasons.derivedFrom`). A template's own `output` sets the
  shape of an ordinary video — that is how a 16:9 import becomes a vertical short — but
  **not** of a derived one: deriving it was the decision, and applying the template again
  turned every square copy back into a tall one. A derived video keeps its shape and is
  matched against the variant for it.
- **`audio.targetLufs`** is how loud the finished video is. A short is published into a
  feed that normalises everything to about -14 LUFS, and a stream recorded at -22 arrives
  quieter than the video before it. The footage is measured over the part being used —
  not the whole four-hour recording, whose loudest second says nothing about this forty
  and costs a minute to find — and placed at the target, with the bookends levelled
  against where it now plays rather than where it was recorded.
  Never at the cost of clipping: the gain is capped so the footage's own peaks stay a
  decibel below full scale, and capped again at twice, which is the most a shot's volume
  can be. Stream audio with peaks near full scale and a low average — a microphone with
  no compressor on it — reaches about -19 rather than -16, and saying so is better than
  a limiter nobody asked for. What that cap never does is turn a video *down*: loudness is
  integrated and gated while a peak is a single sample, so a stream recorded at -27 with
  one mouse click at full scale in it would otherwise be placed quieter than it was
  recorded, which is the opposite of what the template asked for. Such a stream is left
  where it is. `null` leaves the sound exactly as recorded.

  What is measured is the video, never a card in front of it: re-applying a template that
  opens on an intro would otherwise read the sting and level the whole timeline to it. A
  shot whose volume is a fade somebody drew keeps its fade — a fixed value would never be
  seen, and one hand-drawn fade is not a reason to throw away the rest of the apply.
- **A sound whose moment went.** A sound keeps its own length across a cut, which is
  right — a whoosh is not stretched because the shot under it got shorter. But its cue is
  an *instant*, and an instant inside a cut is not an instant any more: it played at the
  joint, with nothing under it. A push-in sting for a push-in that is not there. It is
  skipped now, and a music bed whose whole span the cuts took is skipped too rather than
  sounding for the single frame the collapsed span left it.

- **A picture the cuts shortened.** A picture eases in and out over its own beat, and the
  ease was written against the beat's full length. Shorten that beat from under it — the
  sentence it was placed on loses a second to a false-start cut — and the interpolation
  range runs backwards. Remotion refuses such a range, so the *whole export* died on one
  picture nobody would have missed: `inputRange must be strictly monotonically increasing
  but got [2, 2.25, 2.3, 2.1999…]`. The ease fits inside whatever is left of the beat now,
  and a beat the cuts removed entirely shows nothing at all — the same shape as the
  push-in that killed a real export, found in the two other places it was written.

- **An accent that lost its sentence.** An emphasis is written in source seconds over the
  sentence it belongs to. Cut that sentence away — a false start, a repeated phrase — and
  the span maps to no length at the cut's edge, and the half second either side that makes
  an accent land on its own word then coloured whatever was said there instead: the wrong
  word, in a colour nobody asked for. Nothing was emphasised, so nothing is.

- **Room noise the transcript talks over.** Dead air is normally found in the transcript:
  the gap between one word ending and the next beginning. That works until the recogniser
  is wrong about the clock. A clip from a real stream came out with four and a half
  seconds of room noise in the middle of twenty-one, captioned the whole way — amplify
  that stretch by twenty decibels and transcribe it again and it says nothing, while the
  three seconds *after* it say the very words the transcript placed over the silence.
  Faced with a long pause, a speech model spreads the next phrase's word timings
  backwards across it.

  The dry run says so: how long the stretch is, where it starts, and the first words the
  transcript claims are being said there. It does not cut it. Cutting would take the
  captions for speech that is still in the video, and putting the words back where the
  sound is needs a forced alignment, not a threshold — so the reading goes to the person,
  who can trim the clip, move its start, or choose another moment. A stretch counts when
  it sits thirteen decibels under the clip's own speech for more than a second and a
  half and the words claim most of it. Measured across eight clips of two streams, that
  is one clip and three stretches; the other seven say nothing.

- **False starts.** A stumble is a run of words said twice with only a breath between
  them, and the first run is what goes. The breath the template leaves before the second
  try comes out of the silence between the two and only out of that: a stumble often has
  no silence in it at all — the words run straight into their own repetition — and taking
  a tenth of a second off the front of the second copy left a tenth of a second of the
  *first* one behind, the tail of a word, which is heard as a stutter. Found by running
  three hundred generated transcripts through the whole pass and asking the one thing a
  cut must never do: every word is either entirely there or entirely gone.

- **What a template written by somebody else may not be.** A caption look that does not
  exist, a parent that does not exist, and a template that extends itself are all refused
  when the document is saved, each naming what is wrong. So is a ring — `uno` extending
  `tres` extending `dos` extending `uno` — and refusing it *before* writing is the point:
  found on the next read instead, a ring makes every template in it unreadable, so the
  app drops them from the list and the author finds two documents gone with no way back
  but a text editor. An output frame with an odd side is evened rather than refused,
  because h264 with 4:2:0 chroma cannot encode one: the encoder rounds it down silently
  and the project would otherwise go on computing every caption position, seam and audit
  crop against a frame a pixel wider than the file.

- **At the scale it is for.** Four hours and twenty-three minutes of stream, from a pack
  installed on an empty workspace: transcribed in 12.8 minutes (29,191 words), signals in
  another 5, eight clips chosen by 22, the owner's rule judged to hold on every one of
  them, each framed and hooked and ended on the card, rendered, and read back out of the
  pixels — 48 checks, none failed.

- **Framing across recordings.** Rectangles are fractions so a template survives a change
  of resolution — the same OBS scene is 1920x1080 on one machine and 1728x1116 on another
  — not so it survives a change of *shape*. `stream-short` carries the rectangles of the
  scene its author records; on a 16:9 recording its screen rectangle is a different shape
  from the half it fills, and the dry run says so, with the pixels that would actually
  show, before anything is applied. A split template with no camera rectangle is refused
  at the same point, beside the missing-slot refusal, rather than part-way through an
  import. Framing is for the video: a card somebody pinned to the timeline, and b-roll
  floating over it on its own layer, are left as they are rather than cut into two halves.

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
  a schematic SVG of the layout. Given `?project=&sequence=` instead, it draws the
  template in the shape of *that* video, variants and all — which is the point of them,
  and a 9:16 schematic beside a square video is the wrong drawing — hook, caption band in the template's colours, picture
  plate, watermark corner, cards, bookends. A schematic, not a render.

## Framing: the screen and the person

A stream is a screen with a person in the corner of it. A single crop of that frame is
mostly wallpaper with the speaker sliced off at an edge, so `layout` stacks the two
rectangles that matter instead — the screen stopping where the camera starts, so the
speaker is not in both:

```json
"layout": {
  "mode": "split",
  "screen": { "x": 0, "y": 0, "w": 0.69, "h": 1 },
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
  clip is actually about when the whole desktop is too much. A pane always loses a little
  this way; when a rectangle loses more than a third of itself the dry run says so, and
  says what does show, because otherwise "the left two thirds of my screen" quietly
  becomes the middle of that and only a render shows it.
- `mode` is `source` (leave each shot's own framing alone — what every template did
  before this and what a captions-and-cuts template should keep doing), `crop` (centre
  crop, for a talking head) or `split`.
- The camera rectangle has no sane default: nothing can read it off a document. A split
  without one is refused, and the dry run says so before anything is applied. The
  Templates panel has a **Framing** block for exactly this — which half the person is
  in, how much height they take, and both rectangles as whole percentages of your own
  recording — so adopting someone else's stream template is a matter of typing where
  your webcam sits and saving it under your own name.
- The framing is written onto every shot that has footage, including one with no
  transcript, and only when it differs from what is already there — so re-applying
  converges and a project that was already framed this way is not touched. A template
  whose `mode` is `source` leaves a hand-made split exactly as it is.
  Framing is a property the template sets, the way `captions` is, not a layer it owns:
  a seam you move by hand on one video is written over the next time that template is
  applied to it. Change it in the template, or in the overrides you apply with, when you
  want it to stick — and use `mode: "source"` for a template that should keep its hands
  off the framing altogether.
- `template.plan` reports `framing`: the mode, which half the camera is in, and where
  the seam falls as a share of height. Three more mistakes are called out there, because
  all of them are invisible until the first render: captions that start above the seam
  and run past it; captions that clear it on the wrong side and land on the speaker's
  face, which is what a variant that moves the seam and not the captions produces; and a
  screen rectangle wide enough that the webcam shows through it — the speaker then
  appears twice, small in the screen pane and large in their own. Stop the screen where
  the camera starts, which is what the built-in does.
- A variant that moves the seam has to move the captions with it. `stream-short` carries
  both in each of its shapes, which is why a short derived into a square still reads one
  word at a time just above the seam rather than across the speaker's face.

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

Framing is scored on evidence rather than taste, because it is the loudest thing a
template does and the one thing that can be plainly wrong: a template that stacks a
screen above a speaker needs a frame with both in it, so it is argued for on a wide
screen-share recording and argued against on a video shot upright, where a split is two
crops of the same face.

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
- `rhythm.silence` is the pace, and it is the setting most worth measuring rather than
  guessing. `minGapSec` is what counts as dead air; `keepSec` is what is left where it
  was cut. The first `stream-short` cut every gap over a third of a second down to a
  tenth, which left **no** pause over a third of a second anywhere in the finished video,
  while the channel it was modelled on keeps one every three seconds. It cut the
  breathing along with the dead air, and no still frame shows that.

  ```
  pnpm exec tsx scripts/pace.ts my-published-short.mp4 --against raw-clip.mp4
  ```

  measures a video you already like — the distribution of the pauses it kept — and
  searches for the `minGapSec` and `keepSec` that reproduce it on your own material.
  It matches the pauses, not the running time: material with more thinking in it than
  the finished video had needs a shorter `minGapSec` than the fit suggests, or every bit
  of thinking survives. `src/lib/templates/pace.ts` is the same measurement as a module.
- `rhythm.redundancy` cuts a phrase said twice in a row — the false start a stream is full
  of, "y entonces yo… y entonces yo creo que". There is no silence in it, so the dead-air
  pass cannot see it; what marks it is the repetition. The stumble goes and the run that
  continues the sentence stays. `minWords` is 2 because a single repeated word is as often
  emphasis ("muy, muy bueno") as a stutter, and `maxGapSec` is what separates a stumble
  from saying something again on purpose. So does a full stop: "el problema siempre es
  ese 10% extra. Ese 10% extra es donde mueren los proyectos" is a sentence finished and
  then picked up again, which is the line the clip was chosen for — a run that ended its
  sentence is kept.
- `hook.mode` is `sticky` (its own layer, the whole video), `intro` (`seconds` only) or `off`.
  Its text comes from `hookText`, then the template's own `hook.text`, then a hook written
  on any shot, then a footage shot's title, then the video's own title — never a canvas
  layer's title, whatever order the layers happen to sit in, and never a name nobody
  chose. A fresh import's shot is called `dia-169-restream.mp4` and its timeline is called
  "Main video"; a sticky card reading either, held from the first frame to the last, is the
  worst thing a template can put on screen. Neither is used, and the dry run says there is
  no hook rather than inventing one. `{{hook}}`, `{{title}}` and `{{slot:<id>}}` are substituted.
- `hook.maxWords` is the length a card holds, and the clip selection is asked for a line
  that fits it: run again on the same material, its four hooks came back at five to ten
  words — "¿Qué pedo? ¿Qué me falta?" — where sentences of sixteen and twenty had been
  arriving before, each losing its ending to make room.
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

## Reading a finished video back

```bash
pnpm exec tsx scripts/style-audit.ts PROJECT_ID
```

Every claim a template makes is checkable against the export and none of them are
checkable by reading the project. The checks read each video's own template rather than
one look: a band is compared against the half of the split it is actually in, a hook held
for the whole video is checked across the body while one given three seconds is checked
at its own middle and again after it should be gone, and the moment with no caption on
screen is found the way the renderer finds it — a line reader holds its whole line across
the gaps inside it, so the gap between two words is not one. This rebuilds each pane from the footage — cropped and
scaled the way the layout says, at the moment the cuts say — and compares it with the
pane that was exported; then it checks the hook card is on screen across the body and off
the end card, that a word being spoken lights the caption band while a gap does not, and
that the end card is the card itself and plays whole.

On two shorts cut from a three-hour stream it reads:

```
the bottom pane is the footage framed as the layout says: worst 3.0/255 over 4 moments ✓
the hook card holds across the body: 53%, 53%, 53% white ✓
a word lights the caption band: 39 on "Es" against 24 in a gap ✓
the end card is the card itself: 0.6/255 ✓
```

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
| `stream-short` | A short cut from a screen-share stream: the screen on top, the person below, a hook held for the whole video, one word at a time above the seam, and the card you end every video on. Square and 4:5 give the person a larger share, because a webcam is about as wide as it is tall and a third of a square frame is not |

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

`stream-short` was measured on two four-hour streams of the channel it was modelled on,
through the whole pipeline — transcribe, choose clips, apply the rules, render, read the
export back. Sixteen shorts. Every one of the forty-eight checks `scripts/style-audit.ts`
makes passed on the eight that were rendered: each pane agrees with the layout to within
three parts in 255, the hook holds from the first frame of the body to the last and is
off the end card, a word lights the caption band while a gap does not, and the card is
the card and plays whole. No cut lands on a word in either VOD — every one clears the
nearest word by 150ms — and the pace lands at 20.3 and 19.9 pauses over a third of a
second per minute against the reference's 20.5, on two bodies of material, which is what
says the setting was measured rather than fitted to one of them. The captions sit on the
speech: `scripts/caption-sync.ts` reads an average shift of 5ms across the eight, and the
eight exports land between -18.0 and -20.2 LUFS with peaks between -1.0 and -2.1dB, which
is the loudness of the channel's own published short without a limiter anywhere.

The sound was measured the same way. The channel's own published short reads -18.1 LUFS
with peaks at -0.6dB; what this produced read -21.8 with peaks at -1.1, which in a feed
that normalises to about -14 is the difference between being heard and being scrolled
past. With `audio.targetLufs` the same clip exports at -20.1 and still peaks at -1.1 —
the rest of the gap is a microphone with no compressor on it, and a limiter to close it
is not something a template should do without being asked.

That last sentence was tested rather than assumed. Basing the ceiling on the body of the
sound instead of its loudest sample — the level all but a thousandth of the samples are
below — lets the same clips reach the target: two of them exported at -16.6 and -16.7
LUFS, three decibels louder, and peaking at -0.9 and 0.0dB. Zero is clipping. Re-exported
with the ceiling back on the peak they read -16.7 and -18.7 LUFS and peak at exactly -1.0,
which is the trade taken: this material reaches -16 only through a limiter, and a template
that quietly installs one is not honest about what it did.

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
