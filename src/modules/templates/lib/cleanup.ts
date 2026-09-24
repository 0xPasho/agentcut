import type { Word } from "../../transcription/lib/transcript";
import type { TemplateRhythm } from "../types";
import { toSentences } from "./script";

/**
 * The two cuts a person makes to a recording of somebody talking, and neither of them
 * is silence.
 *
 * A recording read straight through has three kinds of waste in it: the pauses, which
 * `rhythm.silence` takes out; the stall a mouth makes while the head catches up — "um",
 * "uh" — which is speech and so invisible to a silence pass; and the take that was
 * abandoned and said again, which is also speech, and whose words are *different* from
 * the ones that replace them, so the exact-repeat pass (`rhythm.redundancy`) cannot see
 * it either. This file is those last two.
 *
 * The numbers come from measuring what a published news channel actually keeps rather
 * than from taste: across three published news videos of this kind (95 minutes of them,
 * read off their own captions), "like"
 * survives 1.3-1.7 times a minute and "so" 1.4-1.8 — that is a voice, and scrubbing it
 * would make the video sound like a press release — while "uh" survives 0.04 times a
 * minute, and a two-word run said twice in a row 0.05. So: stalls go, restarts go,
 * discourse markers stay.
 */

export type Cut = { type: "silence"; t: number; d: number };

/** Letters and digits only, accent-folded. "Um," and "um" are the same stall. */
const spoken = (word: string) =>
  word.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\p{L}\p{N}]/gu, "");

const MIN_CUT_SEC = 0.08;
/** Punctuation that ends a sentence, with a closing quote or bracket after it. */
const TERMINAL = /[.!?\u2026]["'\u00bb)\]]?$/;
/** A gap this long is a sentence ending, whatever the transcriber wrote. Matches `toSentences`. */
const SENTENCE_PAUSE = 0.75;
/** Two takes of one sentence open on the same words. One word in common is a coincidence. */
const MIN_EXACT_PREFIX = 2;

/**
 * Cuts for the stall words.
 *
 * The word itself is spoken, so the cut has to take the word — and with it the dead air
 * it is sitting in, because a stall is nearly always surrounded by hesitation: "so… uh…
 * the thing is" is one hole, not a word between two pauses. A breath of `keepSec` is
 * left either side so the join does not click.
 *
 * `words` is a list rather than a rule because which sound is a stall depends on the
 * language, and because the line between a stall and a word is not one code can draw:
 * "este" is a stall in Spanish and also an ordinary demonstrative, so it is not in the
 * default list and a channel that wants it adds it.
 */
export function fillerCuts(words: Word[], rhythm: TemplateRhythm["filler"], clipDuration: number): Cut[] {
  const cuts: Cut[] = [];
  if (!rhythm.enabled || words.length < 2) return cuts;
  const stalls = new Set(rhythm.words.map(spoken).filter(Boolean));
  if (!stalls.size) return cuts;

  let i = 0;
  while (i < words.length) {
    if (!stalls.has(spoken(words[i].w))) { i++; continue; }
    // "um uh" is one hesitation, and cutting it as two leaves the gap between them.
    let end = i;
    while (end + 1 < words.length && stalls.has(spoken(words[end + 1].w))) end++;
    const first = words[i];
    const last = words[end];
    const lastEnd = last.t + last.d;
    // A hum held for a second and a half is doing something — thinking out loud on
    // purpose, a groan at what is on screen — and taking it out reads as a jump.
    const holds = lastEnd - first.t > rhythm.maxWordSec;
    // Everything the shot says cannot be a stall: that is a shot of somebody hesitating,
    // and there would be nothing left of it.
    const onlyWords = end - i + 1 === words.length;
    if (holds || onlyWords) { i = end + 1; continue; }

    const previousEnd = i > 0 ? words[i - 1].t + words[i - 1].d : null;
    const nextStart = end + 1 < words.length ? words[end + 1].t : null;
    // A stall never *ends* a sentence: it is the sound of somebody about to keep talking.
    // The same sound at the end of one is a tag — "está chida, ¿eh?", "es un buen video,
    // eh." — and that is a word, not a hole. Over seven hours of a real stream every
    // "eh" but one was this, and cutting them took the sentence's ending with them.
    // A stall that *opens* a sentence is still a stall, however the transcriber
    // punctuated it: "Eh… No. O sea…" starts on one.
    const opensSentence = previousEnd === null
      || TERMINAL.test(words[i - 1].w.trim())
      || first.t - previousEnd >= SENTENCE_PAUSE;
    const endsSentence = nextStart === null
      || TERMINAL.test(last.w.trim())
      || nextStart - lastEnd >= SENTENCE_PAUSE;
    if (!opensSentence && endsSentence) { i = end + 1; continue; }
    // Where there is a gap, the cut starts inside it — a breath after the last real word
    // — and where there is none it starts on the stall itself. Never before the previous
    // word ends: the recogniser's clock is loose enough without help.
    //
    // It reaches at most `maxWordSec` into the silence either side. Past that the hole is
    // dead air rather than hesitation, and dead air belongs to `rhythm.silence`, which
    // reads the sound before it cuts: a six-second gap the transcript claims is empty has
    // a word in it often enough that this pass must not swallow it blind.
    const from = previousEnd === null ? first.t : Math.min(first.t, Math.max(previousEnd + rhythm.keepSec, first.t - rhythm.maxWordSec));
    const to = nextStart === null ? lastEnd : Math.max(lastEnd, Math.min(nextStart - rhythm.keepSec, lastEnd + rhythm.maxWordSec));
    const d = to - from;
    if (d >= MIN_CUT_SEC && from >= 0 && from + d <= clipDuration) cuts.push({ type: "silence", t: from, d });
    i = end + 1;
  }
  return cuts;
}

/** How much of two openings of length `n` is the same word in the same place. */
function openingMatch(a: string[], b: string[], n: number): number {
  let same = 0;
  for (let i = 0; i < n; i++) if (a[i] === b[i]) same++;
  return same / n;
}

/** How many words the two start with identically. */
function exactPrefix(a: string[], b: string[]): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

/**
 * The words an abandoned take is left hanging on. A take that stops has stopped on the
 * way to something — "como dije antes, el—", "as I said before, the" — so what is left
 * past the shared opening is grammar, not content. A take that stops on a *noun* said
 * what it came to say: "puedes abrir un YouTube, puedes abrir un Software" is a list,
 * and dropping the first item loses YouTube.
 *
 * Closed-class words in the two languages this is used in. A word not on the list is
 * treated as content, which is the safe direction: the take is kept.
 */
const HANGING = new Set([
  "the", "a", "an", "and", "or", "but", "so", "that", "this", "these", "those", "it", "its", "is", "are", "was", "were",
  "i", "you", "we", "they", "he", "she", "to", "of", "in", "on", "at", "for", "with", "from", "my", "your", "our", "their",
  "be", "been", "as", "if", "when", "then", "there", "here", "what", "which", "who", "how", "do", "does", "did", "have",
  "has", "had", "will", "would", "can", "could", "just", "about", "like", "kind",
  "el", "la", "los", "las", "un", "una", "unos", "unas", "lo", "le", "les", "y", "e", "o", "u", "pero", "que", "de", "del",
  "al", "en", "con", "por", "para", "es", "son", "era", "eran", "esta", "este", "esto", "estas", "estos", "esa", "ese",
  "eso", "esas", "esos", "yo", "tu", "el", "ella", "nos", "se", "me", "te", "su", "sus", "mi", "mis", "no", "si", "ya",
  "muy", "mas", "cuando", "como", "donde", "porque", "entonces", "tambien", "hay", "ha", "he", "va", "vamos", "sea",
  "ser", "estar", "the",
]);

/**
 * Cuts for a take that was abandoned and said again.
 *
 * This is the one a viewer notices and no other pass can reach. "As I said before, the
 * model— as I said before, this model is the one": both takes are speech, so the silence
 * pass is blind to it; the second is not word-for-word the first, so the exact-repeat
 * pass is blind to it too; and the two runs are not adjacent — there are a few words of
 * the abandoned take in between — so nothing that compares neighbours finds it either.
 *
 * What marks it is the shape. A sentence opens, gets a few words in, stops, and the next
 * run opens the same way and this time carries on. So a candidate is a point in the
 * speech where what follows *re-opens* what came before it:
 *
 * - the two openings line up over `minWords` words or more, at `similarity` or better —
 *   the same start said again, allowing the word or two that changed on the second run;
 * - the abandoned take has almost nothing past that shared opening (`strayWords`), which
 *   is what "abandoned" means. "The model is fast. The model is cheap." keeps both,
 *   because the first one goes somewhere the second does not;
 * - the second take runs longer than the first did;
 * - the first take did not finish its sentence. A full stop between them is a speaker
 *   coming back to a point on purpose, which is a figure of speech and often the line
 *   the clip was chosen for;
 * - the restart happens within `maxGapSec`. Longer, and saying it again is a decision.
 *
 * Only the abandoned take is removed. The run that continues is the one that was meant,
 * which is what makes this a cut rather than a choice between two versions.
 */
export function retakeCuts(words: Word[], rhythm: TemplateRhythm["retake"], clipDuration: number, fillerWords: string[] = []): Cut[] {
  const cuts: Cut[] = [];
  if (!rhythm.enabled || words.length < rhythm.minWords * 2) return cuts;
  const stalls = new Set(fillerWords.map(spoken).filter(Boolean));
  const sentences = toSentences(words);

  let cutUntil = -1;
  for (let i = 0; i < sentences.length; i++) {
    // A restart crosses a sentence boundary as often as it sits inside one: the
    // transcriber writes a full stop where the speaker gave up, or writes nothing at
    // all. So the window is this sentence and the next, and where the boundary falls
    // inside it does not matter.
    const window = [...sentences[i].words, ...(sentences[i + 1]?.words ?? [])];
    if (window.length < rhythm.minWords * 2) continue;
    const spokenWords = window.map((word) => spoken(word.w));
    // Stalls are not evidence either way: "the model— uh— the model is" is one restart.
    const keep = window.map((_, index) => Boolean(spokenWords[index]) && !stalls.has(spokenWords[index]));

    for (let j = 1; j < window.length; j++) {
      if (window[j].t <= cutUntil) continue;
      const gap = window[j].t - (window[j - 1].t + window[j - 1].d);
      // A restart is the words picked straight back up. A long silence and then the same
      // opening is a recap, and belongs to whoever is watching.
      if (gap > rhythm.maxGapSec) continue;
      // A run that finished its sentence was not abandoned.
      if (TERMINAL.test(window[j - 1].w.trim())) continue;
      const before: string[] = [];
      for (let k = 0; k < j; k++) if (keep[k]) before.push(spokenWords[k]);
      const after: string[] = [];
      for (let k = j; k < window.length; k++) if (keep[k]) after.push(spokenWords[k]);
      if (before.length < rhythm.minWords || before.length > rhythm.maxWords) continue;
      if (after.length <= before.length) continue;

      // Two takes of the same sentence start with the same words, not with words that
      // happen to line up: "para preguntas o es solo" against "para código o es solo"
      // matches four of five and is a list of two alternatives, not a stumble.
      if (exactPrefix(before, after) < MIN_EXACT_PREFIX) continue;

      let opening = 0;
      // Longest first: "as i said before this" matching at 0.8 is better evidence than
      // "as i said" matching at 1. A word that differs at the very end of the abandoned
      // take is not evidence of a restart at all — that is where a list changes item —
      // so an opening that ends on the mismatch is not taken.
      for (let n = Math.min(before.length, after.length); n >= rhythm.minWords; n--) {
        if (before[n - 1] !== after[n - 1]) continue;
        if (openingMatch(before, after, n) >= rhythm.similarity) { opening = n; break; }
      }
      if (!opening || before.length - opening > rhythm.strayWords) continue;
      // What the abandoned take is left hanging on has to be grammar. Ending on a word
      // that carries meaning means it was not abandoned, it was said.
      if (before.slice(opening).some((token) => !HANGING.has(token))) continue;

      const t = sentences[i].t;
      const breath = Math.min(rhythm.keepSec, Math.max(0, gap));
      const d = window[j].t - breath - t;
      if (d < MIN_CUT_SEC || t < 0 || t + d > clipDuration) continue;
      cuts.push({ type: "silence", t, d });
      cutUntil = t + d;
      break;
    }
  }
  return cuts;
}
