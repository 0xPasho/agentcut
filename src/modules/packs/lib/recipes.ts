import type { PackRecipe, RecipeParam } from "../types";

/**
 * A recipe's parameters as it will receive them: every declared one, from what was
 * given or else its default, coerced to its declared type. One function, so the
 * editor's form and a tool call can never disagree about what a value means.
 */
export function resolveRecipeParams(recipe: Pick<PackRecipe, "id" | "params">, given: Record<string, unknown> = {}): Record<string, unknown> {
  const unknown = Object.keys(given).filter((name) => !(name in recipe.params));
  if (unknown.length) throw new Error(`${recipe.id} does not take ${unknown.join(", ")}`);
  const out: Record<string, unknown> = {};
  for (const [name, param] of Object.entries(recipe.params)) {
    const raw = name in given && given[name] !== "" && given[name] !== undefined ? given[name] : param.default;
    if (raw === undefined || raw === null) {
      if (param.required) throw new Error(`${recipe.id} needs ${name}${param.description ? `: ${param.description}` : ""}`);
      continue;
    }
    out[name] = coerce(recipe.id, name, param, raw);
  }
  return out;
}

function coerce(recipe: string, name: string, param: RecipeParam, raw: unknown): unknown {
  const wrong = () => new Error(`${recipe}: ${name} must be ${param.type === "json" ? "JSON" : `a ${param.type}`}`);
  if (param.type === "json") {
    if (typeof raw !== "string") return raw;
    try { return JSON.parse(raw); } catch { throw wrong(); }
  }
  if (param.type === "number") {
    const value = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isFinite(value)) throw wrong();
    return value;
  }
  if (param.type === "boolean") {
    if (typeof raw === "boolean") return raw;
    if (raw === "true") return true;
    if (raw === "false") return false;
    throw wrong();
  }
  if (typeof raw !== "string") throw wrong();
  return raw;
}

/** How a parameter's current value is written into a form field. */
export const recipeParamText = (param: RecipeParam, value: unknown): string =>
  value === undefined || value === null ? "" : param.type === "json" ? JSON.stringify(value, null, 2) : String(value);
