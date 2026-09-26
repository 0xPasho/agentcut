# Showcase: a model comparison cut from a stream

One long horizontal video out of a live stream where two models (or tools) get the same
prompt and are judged side by side: the news about the new one, the test, the results,
the verdict. Native stream size, no captions burned in.

## Who it is for

Developers who want to know if the new model is worth it. They came for the result: the
two things built with the same prompt, side by side, and an honest grade.

## Structure, in this order

1. **Teaser** (about 10 s, recipe `teaser`): two to four moments from later in the video
   — each result at its best or worst and the line that sums it up ("la diferencia es
   abismal") — as a trailer: bars, "A CONTINUACIÓN", dramatic music.
2. **Greeting on the camera full screen** (recipe `camera-intro`): what is compared and
   with what prompt, in one breath. The camera then settles into its corner.
3. **Jump card at about 25 s** (recipe `jump-card`) pointing at the first shot of the test.
4. **The news**, as concise as it can be: prices, the benchmarks that matter, coding,
   and the speaker's opinion on each. Reading without an opinion goes.
5. **The test**: same prompt, same effort, one folder per model, both started.
6. **The wait**: only progress marks survive (an API error and its retry, which one
   finished first and how long each took, what the speaker notices while it runs).
7. **Results**: the first model's game played, then both side by side, one to one.
8. **Verdict**: the grade for each, and the goodbye.

## What comes out

- Anything the rest of the video contradicts. If the speaker says a result "is already
  built" and the video then builds it again, that claim goes.
- A failed run and everything about it. If the first attempt went wrong and was redone,
  the video joins the news straight to the redo, as if it went right the first time.
- Chat readings and answers during the wait, the setup (ports, folders, dev servers),
  going for water, reading the usage meter.
- Retakes: when a sentence is said twice, the second, complete take stays. Starts said
  under the breath before the real one go too.
- Silence over talk; in gameplay only long dead stretches, because the picture is moving.

## What stays

- The speaker's reactions while playing ("qué horrible", "está buena la animación").
- The honest mishaps that explain a number (an error that made one model take longer).
- The verdict whole, with the grades.

## Cutting

Word timings from the recogniser drift by up to half a second, and it merges a phrase
said twice into one. Put cuts in the silences of the audio, and after cutting listen
back or transcribe the cut audio again: a missing digit ("modelo 5") or a doubled
greeting only shows up there.
