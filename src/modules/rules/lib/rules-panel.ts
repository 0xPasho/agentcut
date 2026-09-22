import type { RuleRecord, Rule } from "../types";

export const stripRecord = (r: RuleRecord): Rule => {
  const { level, file, promptText, ...rule } = r; void level; void file; void promptText;
  return rule;
};
