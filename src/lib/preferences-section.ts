/**
 * The markers around what the setup interview wrote in preferences.md, and the two
 * functions that respect them. No node imports: the settings editor needs the same
 * split in the browser that the interview uses on the server, and a second copy of
 * these markers is how a rerun ends up appending a duplicate of everything
 * (decision 62). One definition, both sides.
 */
export const PREFERENCES_SECTION_START = "<!-- agentcut:onboarding -->";
export const PREFERENCES_SECTION_END = "<!-- /agentcut:onboarding -->";

/**
 * Preferences written by the interview live in a marked section, so running it
 * again replaces them instead of appending a second copy. Anything the owner wrote
 * by hand is outside the markers and is never touched.
 */
export function mergeOnboardingPreferences(existing: string, generated: string): string {
  const block = `${PREFERENCES_SECTION_START}\n${generated.trim()}\n${PREFERENCES_SECTION_END}`;
  const start = existing.indexOf(PREFERENCES_SECTION_START);
  const end = existing.indexOf(PREFERENCES_SECTION_END);
  if (start !== -1 && end > start) {
    return (existing.slice(0, start) + block + existing.slice(end + PREFERENCES_SECTION_END.length)).trim();
  }
  return [existing.trim(), block].filter(Boolean).join("\n\n");
}

/**
 * The two halves of preferences.md: what the owner typed, and what the interview
 * wrote between its markers. The settings editor shows them apart so a hand edit
 * cannot delete a marker by accident, and reassembles through `merge` above, which
 * keeps one shape of this file however it was edited.
 */
export function splitOnboardingPreferences(text: string): { own: string; generated: string } {
  const start = text.indexOf(PREFERENCES_SECTION_START);
  const end = text.indexOf(PREFERENCES_SECTION_END);
  if (start === -1 || end <= start) return { own: text.trim(), generated: "" };
  return {
    own: (text.slice(0, start) + text.slice(end + PREFERENCES_SECTION_END.length)).trim(),
    generated: text.slice(start + PREFERENCES_SECTION_START.length, end).trim(),
  };
}
