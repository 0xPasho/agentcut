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
