/**
 * The engine a transcript the person handed over is recorded under, followed by its
 * format (`provided:srt`). The recogniser never replaces one: see `ensureTranscript`.
 */
export const PROVIDED_ENGINE = "provided:";

/** The file kept next to `transcript.json` saying where a provided transcript came from. */
export const PROVIDED_RECORD = "transcript.provided.json";

/** What the file picker offers. Anything else is still read by what it contains. */
export const TRANSCRIPT_EXTENSIONS = [".srt", ".vtt", ".json", ".txt"];

/** Grouping words that arrived without lines: a pause this long starts a new line... */
export const SEGMENT_GAP_SEC = 1;
/** ...a line never runs longer than this... */
export const SEGMENT_MAX_SEC = 15;
/** ...and a full stop ends one only once it has run this long. */
export const SEGMENT_MIN_SEC = 2;

/**
 * A word whose file gives it no end lasts until the next one, but never longer than
 * this: a caption that stays lit through a long pause reads as a stuck highlight.
 */
export const WORD_MAX_SEC = 1.2;

/**
 * Times above this, in a file that does not say its unit, are milliseconds: no
 * recording this app cuts runs ten hours, and a millisecond clock passes it in ten minutes.
 */
export const MS_THRESHOLD = 36_000;

/**
 * A line timed only by where it starts lasts at most this long per word, and never less
 * than the minimum: slow speech is ~0.5 s a word, so this is room, not a guess at pace.
 */
export const LINE_SEC_PER_WORD = 0.6;
export const LINE_MIN_SEC = 2.5;
