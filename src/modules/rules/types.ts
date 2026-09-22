import { z } from "zod";
import { SlotValue } from "../templates/lib/plan";

/**
 * A rule is a judgement plus an action. `when` is a sentence an agent reads against
 * the material ("this clip is gameplay", "the speaker talks about the stream");
 * `then` is structured and executed by the host through the same operations a
 * person uses. Nothing in `then` needs a model, which is what keeps a rule
 * inspectable in the UI and testable without one.
 */
export const RuleStage = z.enum(["select", "edit", "both"]);
export type RuleStage = z.infer<typeof RuleStage>;

export const RuleAction = z.object({
  /** Apply this template. The highest-priority matched rule naming one wins. */
  template: z.string().min(1).optional(),
  /** A field-level patch over whichever template ends up applied. Merged across matched rules in priority order. */
  overrides: z.record(z.string(), z.unknown()).optional(),
  /**
   * Named inputs the rule supplies to that template: the end card this channel
   * finishes on, the bed it plays under everything. A rule that can name a template
   * but not fill its slots can only ever choose *someone else's* assets, which is why
   * "end every clip on my outro" could not be written as a rule before. A slot the
   * caller fills wins, and a pack remaps these ids when it is installed.
   */
  slots: z.record(z.string(), SlotValue).optional(),
  /** Free text handed to the agent as a constraint when this rule matches. */
  prompt: z.string().optional(),
  /** Same, read from a markdown file next to the rule. Resolved at load; wins over `prompt`. */
  promptFile: z.string().optional(),
}).strict();
export type RuleAction = z.infer<typeof RuleAction>;

export const Rule = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "lowercase letters, digits and dashes"),
  name: z.string().min(1),
  description: z.string().default(""),
  /** The condition, in plain language. An agent judges it; a person reads it. */
  when: z.string().min(1),
  stage: RuleStage.default("both"),
  /** Lower runs first. Ties keep file order. */
  priority: z.number().int().default(100),
  /** Optional subject this rule is about, matched by name against the glossary. */
  subject: z.string().optional(),
  enabled: z.boolean().default(true),
  then: RuleAction.default({}),
}).strict();
export type Rule = z.infer<typeof Rule>;

export const RuleLevel = z.enum(["workspace", "project"]);
export type RuleLevel = z.infer<typeof RuleLevel>;

export type RuleRecord = Rule & {
  level: RuleLevel;
  file: string;
  /** `then.promptFile` read from disk, or `then.prompt`. */
  promptText: string;
  /**
   * What is doubtful about this rule but not wrong enough to refuse: an override naming
   * a section its template has not got, a slot its template does not offer. Set when the
   * rule is saved, because that is when somebody is looking at what they wrote; a rule
   * that arrives with a pack may name a template that is installed a moment later.
   */
  warnings?: string[];
};

/** What a rule evaluation returns: which rules the agent judged to match, and why. */
export const RuleMatch = z.object({ id: z.string(), reason: z.string().default("") });
export const RuleMatches = z.object({
  matches: z.array(RuleMatch).default([]),
  /** Short labels the agent attached to the material while judging: "gameplay", "tutorial". */
  tags: z.array(z.string()).default([]),
});
export type RuleMatches = z.infer<typeof RuleMatches>;
