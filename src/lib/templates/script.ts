import type { Word } from "../transcript";
import type { Casing } from "../search/brand";
import type { TemplateImages, TemplateRhythm } from "./schema";

/**
 * Deciding *which* sentences deserve a picture is the whole difference between a
 * video that looks edited and a slideshow. The rule this file implements is the
 * one a human editor uses without thinking about it: illustrate a sentence that
 * names something, leave the sentence that only explains it alone, and never put
 * two pictures back to back.
 */

export type Sentence = { index: number; text: string; t: number; d: number; words: Word[] };

const TERMINAL = /[.!?…]["')\]]*$/;
/** A pause this long is a full stop even when the transcriber wrote no punctuation. */
const PAUSE_BREAK = 0.75;
const MAX_WORDS = 24;

/** Split clip-relative words into sentences. Times stay in the clip's own source seconds. */
export function toSentences(words: Word[]): Sentence[] {
  const sentences: Sentence[] = [];
  let current: Word[] = [];
  const flush = () => {
    if (!current.length) return;
    const first = current[0];
    const last = current[current.length - 1];
    sentences.push({
      index: sentences.length,
      text: current.map((w) => w.w).join(" ").replace(/\s+/g, " ").trim(),
      t: first.t,
      d: Math.max(0.05, last.t + last.d - first.t),
      words: current,
    });
    current = [];
  };
  for (const word of words) {
    const previous = current[current.length - 1];
    if (previous && word.t - (previous.t + previous.d) >= PAUSE_BREAK) flush();
    current.push(word);
    if (TERMINAL.test(word.w) || current.length >= MAX_WORDS) flush();
  }
  flush();
  return sentences.map((s, index) => ({ ...s, index }));
}

export type Subject = {
  text: string;
  kind: "brand" | "entity";
  /** Set when the subject is a recognised brand; drives the logo plate. */
  brandSlug?: string;
  brandHex?: string;
};

export type BrandMention = { text: string; slug: string; hex: string };

export type SentenceAnalysis = {
  sentence: Sentence;
  salience: number;
  subjects: Subject[];
  numbers: string[];
  brands: BrandMention[];
};

/**
 * Words that start a sentence and mean nothing on their own. A capital letter at
 * position 0 is grammar, not a name, so these are never mistaken for a subject.
 */
const SENTENCE_STARTERS = new Set([
  "the","a","an","and","but","so","if","when","then","this","that","these","those","it","its","it's",
  "i","i'm","i've","we","we're","you","you're","they","they're","he","she","there","there's","here",
  "what","why","how","who","where","which","because","just","now","also","in","on","at","for","to","of",
  "with","my","your","our","their","his","her","is","are","was","were","do","does","did","don't","doesn't",
  "let","let's","okay","ok","yeah","yes","no","not","really","very","actually","basically","like","well",
  "right","look","listen","imagine","think","first","second","third","next","finally","after","before",
  "every","most","some","any","all","one","two","three","maybe","probably","obviously","honestly","anyway",
]);

/** Common words that are capitalised mid-sentence often enough to be noise. */
const NOT_A_NAME = new Set(["I", "I'm", "I've", "OK", "TV", "A", "The"]);

const NUMBER_WORD = /^(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|trillion|percent|half|double|triple)$/i;

const strip = (word: string) => word.replace(/^[^\p{L}\p{N}$€£#]+|[^\p{L}\p{N}%+]+$/gu, "");

/** Numbers are the cheapest thing to emphasise and the most reliably worth it. */
export function numbersIn(text: string): string[] {
  return text
    .split(/\s+/)
    .map(strip)
    .filter((word) => word && (/\d/.test(word) || NUMBER_WORD.test(word)));
}

/**
 * Runs of capitalised words are the only name signal a transcript reliably carries.
 * A run at position 0 is only a name when its first word is not ordinary grammar.
 *
 * When every word is capitalised, or none is, the signal is gone. Guessing from it
 * anyway would either name every word or name none, so this says nothing instead and
 * leaves the decision to brand matching, which does not depend on case.
 */
export function entitiesIn(text: string, casing: Casing = "mixed"): string[] {
  if (casing !== "mixed") return [];
  const tokens = text.split(/\s+/).map((token) => ({ raw: token, word: strip(token) }));
  const entities: string[] = [];
  let run: string[] = [];
  const flush = (startedAtZero: boolean) => {
    if (!run.length) return;
    const phrase = run.join(" ");
    const single = run.length === 1;
    const ordinary = SENTENCE_STARTERS.has(run[0].toLowerCase()) || NOT_A_NAME.has(run[0]);
    if (!(startedAtZero && ordinary) && !(single && ordinary) && phrase.length > 1) entities.push(phrase);
    run = [];
  };
  let runStart = -1;
  tokens.forEach(({ word }, index) => {
    const named = /^[\p{Lu}][\p{L}\p{N}'’.&-]*$/u.test(word) || /^[\p{Lu}\p{N}]{2,6}$/u.test(word);
    if (named) {
      if (!run.length) runStart = index;
      run.push(word);
    } else flush(runStart === 0);
  });
  flush(runStart === 0);
  return entities;
}

/**
 * Salience answers one question: does this sentence point at something a viewer
 * could be *shown*? Naming a company or a product is the strongest evidence;
 * a number is supporting evidence; an explanation with neither scores near zero,
 * and that is the sentence the template deliberately leaves bare.
 */
export function analyzeSentences(
  sentences: Sentence[],
  brandsBySentence: Map<number, BrandMention[]>,
  casing: Casing = "mixed",
): SentenceAnalysis[] {
  return sentences.map((sentence) => {
    const brands = brandsBySentence.get(sentence.index) ?? [];
    const brandTexts = new Set(brands.map((b) => b.text.toLowerCase()));
    const entities = entitiesIn(sentence.text, casing).filter((entity) => {
      const lower = entity.toLowerCase();
      return ![...brandTexts].some((brand) => lower === brand || lower.includes(brand));
    });
    const numbers = numbersIn(sentence.text);
    const acronym = casing === "mixed" && /\b[\p{Lu}]{2,6}\b/u.test(sentence.text);
    const wordCount = sentence.words.length;

    let salience = 0;
    if (brands.length) salience += 0.55 + Math.min(0.1, (brands.length - 1) * 0.1);
    if (entities.length) salience += 0.4 + Math.min(0.12, (entities.length - 1) * 0.06);
    if (numbers.length) salience += 0.25;
    if (acronym) salience += 0.1;
    if (wordCount >= 7) salience += 0.1;
    if (wordCount <= 3) salience -= 0.25;

    const subjects: Subject[] = [
      ...brands.map((b): Subject => ({ text: b.text, kind: "brand", brandSlug: b.slug, brandHex: b.hex })),
      ...entities.map((text): Subject => ({ text, kind: "entity" })),
    ];
    return { sentence, salience: Math.max(0, Math.min(1, salience)), subjects, numbers, brands };
  });
}

/** One planned picture: when it appears, for how long, and what it should show. */
export type ImageCue = {
  sentenceIndex: number;
  /** Clip-relative source seconds, the timebase every edit uses. */
  t: number;
  d: number;
  /** What to look for. Empty when the template wants a pool picture with no subject. */
  query: string;
  subjects: Subject[];
  salience: number;
};

/**
 * Greedy by how much a sentence wants a picture, then filtered by spacing. Picking
 * the best sentences first and *then* enforcing the gaps is what produces the
 * "roughly every other sentence, where it helps" pattern instead of a metronome.
 */
export function selectImageCues(
  analyses: SentenceAnalysis[],
  images: TemplateImages,
  options: { subjectFree?: boolean; clipDuration?: number } = {},
): ImageCue[] {
  if (images.mode === "off" || !analyses.length) return [];
  // The salience floor exists to stop the tool searching for a picture of something
  // the sentence never named. A still cut from this shot's own footage, or the next
  // picture out of a folder you supplied, has nothing to search for — it needs a
  // moment, not a name — so neither the floor nor the subject applies to it.
  const requireSubject = !options.subjectFree;
  const eligible = analyses.filter((a) => {
    if (requireSubject && !a.subjects.length) return false;
    if (images.mode === "auto" && requireSubject) return a.salience >= images.minSalience;
    return true;
  });
  if (!eligible.length) return [];

  const cap = images.mode === "every"
    ? eligible.length
    : images.mode === "alternate"
      ? Math.ceil(eligible.length / (images.minSentenceGap + 1))
      : Math.max(1, Math.round(images.density * analyses.length));
  const limit = Math.min(images.maxCount, cap);

  const ordered = images.mode === "auto"
    ? [...eligible].sort((a, b) => b.salience - a.salience || a.sentence.index - b.sentence.index)
    : eligible;

  const accepted: SentenceAnalysis[] = [];
  for (const candidate of ordered) {
    if (accepted.length >= limit) break;
    const tooClose = accepted.some((other) =>
      Math.abs(other.sentence.index - candidate.sentence.index) <= images.minSentenceGap ||
      Math.abs(other.sentence.t - candidate.sentence.t) < images.minGapSec);
    if (!tooClose) accepted.push(candidate);
  }

  return accepted
    .sort((a, b) => a.sentence.t - b.sentence.t)
    .map((analysis) => {
      const start = Math.max(0, analysis.sentence.t - images.leadSec);
      const available = options.clipDuration === undefined ? Infinity : Math.max(0.2, options.clipDuration - start);
      return {
        sentenceIndex: analysis.sentence.index,
        t: start,
        d: Math.min(images.durationSec, available),
        query: analysis.subjects[0]?.text ?? "",
        subjects: analysis.subjects,
        salience: analysis.salience,
      };
    })
    .filter((cue) => cue.d >= 0.2);
}

/**
 * What the footage actually sounds like under a shot, in clip-relative seconds: one
 * reading every `stepSec`, each covering the step that follows it.
 */
export type Heard = { stepSec: number; curve: Array<{ t: number; db: number }> };

/** How far under the speaker's own level a reading has to sit to count as a pause. */
export const QUIET_BELOW_DB = 10;
/** Less than this between the loud and the quiet end of a shot, and there is nothing to read. */
const MIN_RANGE_DB = 6;

/**
 * Dead-air cuts. Returns clip-relative silence edits.
 *
 * The transcript proposes them — a gap between one word ending and the next beginning —
 * and, when there is sound to read, the sound decides them. A recogniser's clock is not
 * the recording's: on two real streams a third of the gaps it reported had speech in
 * them, a word it ended early, one it started late, or a phrase it never wrote down, and
 * a cut there takes those words out of the video. So a gap is cut only where the audio
 * is quiet for the template's whole `minGapSec`, and only across that quiet: a gap with
 * a missed word in the middle becomes two cuts either side of it, or none.
 *
 * Measured on eight clips of a real stream, the transcript alone cut 63 seconds of which
 * a third was speech; checked against the sound, no cut had a word in it.
 */
export function silenceCuts(words: Word[], rhythm: TemplateRhythm["silence"], clipDuration: number, heard?: Heard | null) {
  if (!rhythm.enabled) return [] as Array<{ type: "silence"; t: number; d: number }>;
  const cuts: Array<{ type: "silence"; t: number; d: number }> = [];
  const quiet = heard ? quietReadings(words, heard) : null;
  const push = (from: number, to: number) => {
    const t = from + rhythm.keepSec / 2;
    const d = to - from - rhythm.keepSec;
    if (d >= 0.1 && t >= 0 && t + d <= clipDuration) cuts.push({ type: "silence", t, d });
  };
  for (let i = 1; i < words.length; i++) {
    const previousEnd = words[i - 1].t + words[i - 1].d;
    const gap = words[i].t - previousEnd;
    if (gap < rhythm.minGapSec || gap > rhythm.maxGapSec) continue;
    if (!quiet) { push(previousEnd, words[i].t); continue; }
    // The template's pace was measured on transcripts, whose words end early and start
    // late: a gap the transcript calls `minGapSec` is that much less of real silence. So
    // real quiet of `minGapSec - keepSec` is the pause it meant, and the breath it keeps
    // comes out of that quiet, not out of a word.
    const shortest = Math.max(0.4, rhythm.minGapSec - rhythm.keepSec);
    for (const run of quietRuns(quiet, heard!.stepSec, previousEnd, words[i].t))
      if (run.to - run.from >= shortest) push(run.from, run.to);
  }
  return cuts;
}

/**
 * Which readings are quiet, measured against the speaker rather than against a fixed
 * level: a stream mic sits anywhere from -35 to -20 dB, and a pause is a pause relative
 * to the voice in it. `null` when there is too little speech to know the voice from.
 */
function quietReadings(words: Word[], heard: Heard) {
  const inWords = heard.curve.filter((reading) => {
    const middle = reading.t + heard.stepSec / 2;
    return words.some((word) => middle >= word.t && middle <= word.t + word.d);
  }).map((reading) => reading.db).sort((a, b) => a - b);
  if (inWords.length < 5) return null;
  // A tone, a hold, a music bed at one level: sound with no dynamics cannot tell a pause
  // from a word, and the transcript is the better witness there.
  const all = heard.curve.map((reading) => reading.db).sort((a, b) => a - b);
  if (all[Math.floor(all.length * 0.9)] - all[Math.floor(all.length * 0.1)] < MIN_RANGE_DB) return null;
  const limit = inWords[Math.floor(inWords.length / 2)] - QUIET_BELOW_DB;
  const flags = heard.curve.map((reading) => reading.db < limit);
  // A keyboard click is one loud reading between quiet ones; it is not a word.
  for (let i = 1; i < flags.length - 1; i++) if (!flags[i] && flags[i - 1] && flags[i + 1]) flags[i] = true;
  return heard.curve.map((reading, i) => ({ t: reading.t, quiet: flags[i] }));
}

/** The quiet stretches inside `from..to`, clipped to it. Readings are the step that follows them. */
function quietRuns(readings: Array<{ t: number; quiet: boolean }>, stepSec: number, from: number, to: number) {
  const runs: Array<{ from: number; to: number }> = [];
  let start: number | null = null;
  for (const reading of readings) {
    const a = reading.t;
    const b = reading.t + stepSec;
    if (b <= from || a >= to) continue;
    if (reading.quiet) { if (start === null) start = Math.max(a, from); }
    else if (start !== null) { runs.push({ from: start, to: Math.min(a, to) }); start = null; }
  }
  if (start !== null) {
    // Readings stop where the recording does; nothing past the last one is known to be quiet.
    const last = readings.filter((reading) => reading.t < to).at(-1);
    runs.push({ from: start, to: Math.min(to, last ? last.t + stepSec : to) });
  }
  return runs;
}

/** Letters and digits only, accent-folded: "Entonces," and "entonces" are the same word said twice. */
const spoken = (word: string) =>
  word.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\p{L}\p{N}]/gu, "");

/** The longest run of words a false start is worth looking for. Past this it is a rehearsed refrain. */
const MAX_RUN = 10;

/**
 * Cuts for phrases said twice in a row.
 *
 * A false start leaves no gap, so the dead-air pass cannot see it: the words are
 * spoken, at speed, and then spoken again. What marks it is the repetition itself —
 * the same run of words immediately after itself, with only a stumble between them.
 * The first run is removed and the second, which is the one that continues into the
 * sentence, is kept.
 *
 * Only runs of `minWords` or more count. A single repeated word is as often emphasis
 * ("muy, muy bueno") as a stutter, and cutting it changes what was said.
 */
export function redundancyCuts(words: Word[], rhythm: TemplateRhythm["redundancy"], clipDuration: number) {
  const cuts: Array<{ type: "silence"; t: number; d: number }> = [];
  if (!rhythm.enabled || words.length < rhythm.minWords * 2) return cuts;
  const text = words.map((w) => spoken(w.w));

  let i = 0;
  while (i < words.length) {
    let taken = 0;
    // Longest first: "y entonces yo" is one false start, not "y entonces" plus a word.
    for (let n = Math.min(MAX_RUN, Math.floor((words.length - i) / 2)); n >= rhythm.minWords; n--) {
      let repeats = true;
      for (let k = 0; k < n && repeats; k++) repeats = Boolean(text[i + k]) && text[i + k] === text[i + n + k];
      if (!repeats) continue;
      const firstEnd = words[i + n - 1].t + words[i + n - 1].d;
      const secondStart = words[i + n].t;
      // A long pause between the two is a deliberate repetition, not a stumble.
      if (secondStart - firstEnd > rhythm.maxGapSec) continue;
      // So is a full stop between them. "Pero el problema siempre es ese 10% extra.
      // Ese 10% extra es donde…" is a sentence finished and then picked up again for
      // emphasis — a figure of speech, not a false start, and cutting it takes the
      // emphasis out of the one line the clip was chosen for.
      if (/[.!?…]["'»)]?$/.test(words[i + n - 1].w.trim())) continue;
      const t = words[i].t;
      // The breath left before the second try comes out of the silence between the two,
      // and only out of that. A stumble often has no silence in it at all — the words run
      // straight into their own repetition — and taking a tenth of a second off the front
      // of the second copy meant leaving a tenth of a second of the *first* one behind:
      // the tail of a word, eighty milliseconds long, which is heard as a stutter.
      const breath = Math.min(rhythm.keepSec, Math.max(0, secondStart - firstEnd));
      const d = secondStart - breath - t;
      if (d < 0.1 || t < 0 || t + d > clipDuration) continue;
      cuts.push({ type: "silence", t, d });
      taken = n;
      break;
    }
    i += taken || 1;
  }
  return cuts;
}

/**
 * Punch-ins land on the sentences that carry the claim, spaced by the template's
 * rate. A punch on every sentence reads as a nervous tic rather than emphasis.
 */
export function punchBeats(analyses: SentenceAnalysis[], rhythm: TemplateRhythm["punch"], clipDuration: number) {
  if (!rhythm.enabled || !analyses.length) return [] as Array<{ type: "punch"; t: number; d: number; scale: number }>;
  const target = Math.max(0, Math.round((clipDuration / 60) * rhythm.perMinute));
  if (!target) return [];
  const spacing = Math.max(rhythm.durationSec * 2, clipDuration / (target + 1));
  const chosen: SentenceAnalysis[] = [];
  for (const candidate of [...analyses].sort((a, b) => b.salience - a.salience || a.sentence.index - b.sentence.index)) {
    if (chosen.length >= target) break;
    if (candidate.sentence.t + rhythm.durationSec > clipDuration) continue;
    if (chosen.some((other) => Math.abs(other.sentence.t - candidate.sentence.t) < spacing)) continue;
    chosen.push(candidate);
  }
  return chosen
    .sort((a, b) => a.sentence.t - b.sentence.t)
    .map((analysis) => ({
      type: "punch" as const,
      t: analysis.sentence.t,
      d: Math.min(rhythm.durationSec, Math.max(0.3, clipDuration - analysis.sentence.t)),
      scale: rhythm.scale,
    }));
}

/** Colour the words worth colouring: the figure, the name. */
export function emphasisBeats(analyses: SentenceAnalysis[], rhythm: TemplateRhythm["emphasis"], clipDuration: number) {
  if (!rhythm.enabled) return [] as Array<{ type: "emphasis"; t: number; d: number; words: string[]; color: string }>;
  const wants = new Set(rhythm.targets);
  return analyses.flatMap((analysis) => {
    const words = [
      ...(wants.has("numbers") ? analysis.numbers : []),
      ...(wants.has("brands") ? analysis.brands.map((b) => b.text) : []),
      ...(wants.has("entities") ? analysis.subjects.filter((s) => s.kind === "entity").map((s) => s.text) : []),
    ].flatMap((phrase) => phrase.split(/\s+/)).filter(Boolean);
    if (!words.length) return [];
    const d = Math.min(analysis.sentence.d, Math.max(0.3, clipDuration - analysis.sentence.t));
    if (d <= 0) return [];
    return [{ type: "emphasis" as const, t: analysis.sentence.t, d, words: [...new Set(words)], color: rhythm.color }];
  });
}
