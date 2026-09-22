/**
 * Whether a line of text fits the box it is drawn in, decided without measuring it.
 *
 * A caption is laid out by wrapping between words, so a word wider than its box has
 * nowhere to go: it spills out of the frame and the letters at the ends are cut off by
 * it. Real transcripts produce those words — "internacionalización" is twenty letters,
 * a spoken URL is thirty-two, and a Japanese phrase arrives as one token — and the
 * frame is 86% of 1080 pixels wide with the letters at 5.4% of 1920 tall.
 *
 * The width is estimated from the characters rather than measured, because the same
 * answer has to come out of the preview, the export and a test: measuring needs a font
 * that has finished loading and a canvas, and those differ between a browser tab and a
 * render worker. The estimate is deliberately a little generous, so a line it calls a
 * fit is a fit.
 */

/** Characters that take a whole em: CJK, kana, hangul and the full-width forms. */
const FULL_WIDTH = /[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꀀ-꓏ꥠ-꥿가-힣豈-﫿︐-﹯＀-｠￠-￦]/u;
const NARROW = /[iIltjfr.,;:'!|()[\]{}/\\-]/;
const WIDE = /[mwMW@%#&—–]/;

/** How wide a string is, in ems of its own font size. */
export function emWidth(text: string): number {
  let width = 0;
  for (const ch of text) {
    if (FULL_WIDTH.test(ch)) width += 1.05;
    else if (ch === " ") width += 0.28;
    else if (NARROW.test(ch)) width += 0.34;
    else if (WIDE.test(ch)) width += 0.95;
    else if (ch >= "A" && ch <= "Z") width += 0.72;
    else width += 0.62;
  }
  return width;
}

/**
 * How far below a shrunken line may not go. Past this the text is too small to read
 * anyway, so anything longer is left to wrap inside the word instead.
 */
export const MIN_FIT = 0.4;

/**
 * The factor to multiply a font size by so `text` fits `boxEm` ems of it. 1 when it
 * already does. The box is taken three percent narrower than it is, because an estimate
 * that says a line just fits and is wrong puts a letter outside the frame, while one
 * that is wrong the other way makes it imperceptibly smaller.
 */
export function fitScale(text: string, boxEm: number): number {
  const width = emWidth(text);
  const room = boxEm * 0.97;
  if (!width || room <= 0 || width <= room) return 1;
  return Math.max(MIN_FIT, room / width);
}

/** The factor that fits every one of these — a caption line wraps between words, so the widest one decides. */
export const fitScaleAll = (texts: string[], boxEm: number): number =>
  texts.reduce((smallest, text) => Math.min(smallest, fitScale(text, boxEm)), 1);

/** Space between two words of a caption, in ems — the `gap-x` the renderer draws. */
const WORD_GAP = 0.28;

/**
 * The factor that keeps a line of words to `rows` rows of `boxEm` ems, wrapping between
 * words the way the renderer does. 1 when it already fits. A caption that reads a whole
 * sentence at a time is placed by its top edge just above the seam, so a line that
 * wraps to a third row puts its last words over the speaker: shrinking it a little is
 * what keeps the sentence whole and on the right side.
 */
export function fitRows(words: string[], boxEm: number, rows: number): number {
  const room = boxEm * 0.97;
  const count = (scale: number) => {
    let used = 0;
    let taken = 1;
    for (const word of words) {
      const width = emWidth(word) * scale;
      if (used > 0 && used + WORD_GAP * scale + width > room) { taken += 1; used = width; }
      else used += (used > 0 ? WORD_GAP * scale : 0) + width;
    }
    return taken;
  };
  if (!words.length || count(1) <= rows) return 1;
  for (let scale = 0.95; scale > MIN_FIT; scale -= 0.05) if (count(scale) <= rows) return scale;
  return MIN_FIT;
}
