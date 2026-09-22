import type { Schema } from "../types";

export function seed(s: Schema): unknown {
  if (s.default !== undefined) return structuredClone(s.default);
  if (s.const !== undefined) return s.const;
  if (s.enum) return s.enum[0];
  if (s.anyOf || s.oneOf) return seed((s.anyOf ?? s.oneOf)![0]);
  if (s.type === "object") return Object.fromEntries(Object.entries(s.properties ?? {}).map(([k,v]) => [k, seed(v)]));
  if (s.type === "array") return [];
  if (s.type === "number" || s.type === "integer") return s.minimum ?? 0;
  if (s.type === "boolean") return false;
  return "";
}
