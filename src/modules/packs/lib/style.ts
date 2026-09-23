import type { PackExample } from "../types";

/**
 * A pack's style guide is text that another person wrote and that an agent will read as
 * guidance. That is the one thing in a pack that can talk to the agent directly, so it is
 * held to two limits: a size, so it cannot crowd the owner's own preferences out of the
 * prompt, and a scan for the sentences that only make sense as an attack on the agent.
 */

/** About a page. OpenClaw holds its USER.md to 4000 characters for the same reason. */
export const MAX_STYLE_CHARS = 4000;

/**
 * Phrases a style guide has no business containing. A style guide says how videos look
 * and sound; one that tells the agent to ignore its instructions, reveal its prompt, run
 * something or send something somewhere is not a style guide.
 */
const ATTACKS: Array<[RegExp, string]> = [
  [/\b(ignore|disregard|forget|override)\b[^.\n]{0,40}\b(previous|prior|above|earlier|all|system|your)\b[^.\n]{0,20}\b(instructions?|rules?|prompts?|guidelines?)\b/i, "tells the agent to ignore its instructions"],
  [/\b(ignora|olvida|omite)\b[^.\n]{0,40}\b(instrucciones|reglas|indicaciones)\b/i, "tells the agent to ignore its instructions"],
  [/\b(system prompt|developer message|you are now|act as (?:an?|the) (?:admin|root|developer))\b/i, "tries to change who the agent is"],
  [/\b(reveal|print|show|repeat|leak)\b[^.\n]{0,30}\b(system prompt|instructions|api key|token|secret|password)s?\b/i, "asks for secrets or the prompt"],
  [/\b(api[_ -]?key|access[_ -]?token|password|credentials?)\b\s*[:=]/i, "contains a credential"],
  [/\b(curl|wget|rm -rf|sudo|chmod|bash -c|powershell|eval\(|exec\()/i, "contains a command to run"],
  [/\b(delete|remove|wipe|erase)\b[^.\n]{0,30}\b(project|projects|workspace|files?|library|database)\b/i, "asks the agent to delete work"],
  [/\b(send|post|upload|exfiltrate)\b[^.\n]{0,40}https?:\/\//i, "asks the agent to send something to a URL"],
  [/<\s*\/?\s*(system|assistant|tool|function_calls?)\s*>/i, "impersonates a prompt boundary"],
];

export type StyleProblem = { line: number; text: string; why: string };

/** Everything wrong with a style guide, one entry per offending line. Empty is fine. */
export function scanStyle(text: string): StyleProblem[] {
  const problems: StyleProblem[] = [];
  if (text.length > MAX_STYLE_CHARS)
    problems.push({ line: 0, text: "", why: `is ${text.length} characters; a style guide holds ${MAX_STYLE_CHARS}` });
  text.split("\n").forEach((line, index) => {
    for (const [pattern, why] of ATTACKS) if (pattern.test(line)) problems.push({ line: index + 1, text: line.trim().slice(0, 120), why });
  });
  return problems;
}

/** The refusal a person or an agent reads when a style guide will not be saved. */
export const styleRefusal = (problems: StyleProblem[]) =>
  `This style guide will not be used: ${problems.map((p) => (p.line ? `line ${p.line} ${p.why} ("${p.text}")` : `it ${p.why}`)).join("; ")}.`;

/**
 * The guide as an agent reads it. It comes before the owner's preferences in every prompt
 * and says so, because where the two disagree the owner is the one who decides.
 */
export function styleBlock(style: { packName: string; text: string; examples: Array<PackExample & { still: string }> }): string {
  if (!style.text.trim() && !style.examples.length) return "";
  const examples = style.examples.length
    ? `\n\nReference videos for this style — open each still to see it:\n${style.examples.map((e) => `- ${e.still}${e.title ? ` — ${e.title}` : ""}${e.note ? `: ${e.note}` : ""}`).join("\n")}`
    : "";
  return `## The style guide for these videos (${style.packName})\nHow videos in this style are made. The owner's preferences below win where they disagree.\n\n${style.text.trim()}${examples}`;
}
