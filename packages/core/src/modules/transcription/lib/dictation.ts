/**
 * Whisper fills silence with the sentences it heard most in training: subtitle
 * credits and sign-offs. A dictated note that is only one of those was silence.
 */
const SILENCE_PHRASES = [
  /^subt[ií]tulos (realizados )?por la comunidad de amara ?org$/,
  /^(muchas )?gracias por ver( el v[ií]deo)?$/,
  /^thanks? (you )?for watching$/,
  /^suscr[ií]bete( al canal)?$/,
  /^(\[|\()?\s*(m[uú]sica|music|blank_audio|silencio|silence|aplausos|applause)\s*(\]|\))?$/,
];

const fold = (text: string) => text.toLowerCase().replace(/[¡!¿?.,…"'«»]/g, "").replace(/\s+/g, " ").trim();

/** The dictated text, joined and tidied, or "" when the recording held nothing but silence. */
export function cleanDictation(pieces: string[]): string {
  const text = pieces.map((piece) => piece.trim()).filter(Boolean).join(" ")
    .replace(/\[(BLANK_AUDIO|MUSIC|MÚSICA)\]/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  return SILENCE_PHRASES.some((pattern) => pattern.test(fold(text))) ? "" : text;
}
