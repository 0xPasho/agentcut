"use client";
import { useCallback, useEffect, useId, useState } from "react";
import Link from "next/link";
import { CookingPot, Loader2, Play, ShieldAlert } from "lucide-react";
import { api } from "@agentcut/core/common/api/client";
import { Button } from "@/common/ui/button";
import { Input } from "@/common/ui/input";
import { Label } from "@/common/ui/label";
import { Textarea } from "@/common/ui/textarea";
import { recipeParamText, resolveRecipeParams } from "@agentcut/core/modules/packs/lib/recipes";
import type { RecipeRunResult, RecipeView } from "@agentcut/core/modules/packs/types";

/**
 * The editor's way into pack recipes (decision 143). Every run is the agent's
 * `packs.recipes.run` tool with the same parameters, so a person and an agent get the
 * same edit; the unsaved draft is saved first and the editor reloads afterwards.
 */
export function RecipesPanel({ projectId, sequenceId, beforeRun, afterChange }: {
  projectId: string;
  sequenceId?: string;
  beforeRun: () => Promise<boolean>;
  afterChange: () => Promise<void>;
}) {
  const [recipes, setRecipes] = useState<RecipeView[] | null>(null);
  const [open, setOpen] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState<RecipeRunResult | null>(null);

  useEffect(() => {
    api.editorTool<RecipeView[]>(projectId, { tool: "packs.recipes.list" }).then(setRecipes).catch((reason) => setError((reason as Error).message));
  }, [projectId]);

  const choose = useCallback((recipe: RecipeView) => {
    const key = `${recipe.pack}/${recipe.id}`;
    if (open === key) return setOpen("");
    setOpen(key);
    setDone(null);
    setError("");
    setValues(Object.fromEntries(Object.entries(recipe.params).map(([name, param]) =>
      [name, name === "sequenceId" && sequenceId ? sequenceId : recipeParamText(param, param.default)])));
  }, [open, sequenceId]);

  const runRecipe = async (recipe: RecipeView) => {
    setBusy(recipe.id);
    setError("");
    setDone(null);
    try {
      // The same resolution the host does, so a bad value is said before anything is saved.
      resolveRecipeParams(recipe, values);
      if (!(await beforeRun())) throw new Error("Save your changes first; the recipe edits the saved video.");
      const result = await api.editorTool<RecipeRunResult>(projectId, { tool: "packs.recipes.run", pack: recipe.pack, recipe: recipe.id, params: values });
      setDone(result);
      await afterChange();
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(""); }
  };

  if (!recipes) return error ? <p role="alert" className="text-sm text-destructive">{error}</p> : <p className="text-sm text-muted-foreground">Loading recipes…</p>;
  if (!recipes.length) return (
    <p className="text-pretty text-sm text-muted-foreground">
      No installed pack carries recipes. A pack with code shows it on its page in <Link className="underline underline-offset-2" href="/settings/packs">Settings → Packs</Link>, where you read it and trust it.
    </p>
  );

  return (
    <div className="flex flex-col gap-2">
      <p className="text-pretty text-xs text-muted-foreground">Code from a pack that builds part of this video. What it makes is ordinary editing: undo it, change it, or run it again.</p>
      <ul className="flex flex-col gap-2">
        {recipes.map((recipe) => {
          const key = `${recipe.pack}/${recipe.id}`;
          return (
            <li key={key} className="rounded-xl bg-foreground/[0.04] ring-1 ring-foreground/5">
              <button type="button" aria-expanded={open === key} onClick={() => choose(recipe)} className="flex w-full items-start gap-2 rounded-xl px-3 py-2.5 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                <CookingPot aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{recipe.label}</span>
                  <span className="block text-pretty text-xs text-muted-foreground">{recipe.description}</span>
                  <span className="block text-[11px] text-muted-foreground">From {recipe.packName}{recipe.trusted ? "" : " · not trusted"}</span>
                </span>
              </button>
              {open === key && (
                <div className="flex flex-col gap-3 px-3 pb-3">
                  {Object.entries(recipe.params).map(([name, param]) => (
                    <Field key={name} name={name} type={param.type} description={param.description} required={param.required}
                      value={values[name] ?? ""} onChange={(value) => setValues((v) => ({ ...v, [name]: value }))} />
                  ))}
                  {recipe.trusted ? (
                    <Button size="sm" className="self-start" disabled={!!busy} onClick={() => void runRecipe(recipe)}>
                      {busy === recipe.id ? <Loader2 aria-hidden className="motion-safe:animate-spin" /> : <Play aria-hidden />}{busy === recipe.id ? "Running…" : "Run recipe"}
                    </Button>
                  ) : (
                    <p className="flex items-start gap-2 text-pretty text-xs text-muted-foreground">
                      <ShieldAlert aria-hidden className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
                      <span>This is code and it is not trusted on this machine yet. Read it and trust it on <Link className="underline underline-offset-2" href={`/settings/packs/${recipe.pack}`}>the pack&apos;s page</Link>.</span>
                    </p>
                  )}
                  {done && done.recipe === recipe.id && (
                    <div className="rounded-lg bg-emerald-500/10 px-3 py-2 text-xs">
                      <p className="font-medium">Done{done.revision !== null ? ` — revision ${done.revision}` : ""}</p>
                      {done.logs.map((line, i) => <p key={i} className="text-muted-foreground">{line}</p>)}
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {error && <p role="alert" className="text-pretty text-sm text-destructive">{error}</p>}
    </div>
  );
}

function Field({ name, type, description, required, value, onChange }: { name: string; type: string; description: string; required: boolean; value: string; onChange: (value: string) => void }) {
  const id = useId();
  const hint = `${id}-hint`;
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id} className="text-xs">{name}{required ? "" : <span className="font-normal text-muted-foreground"> (optional)</span>}</Label>
      {type === "json"
        ? <Textarea id={id} aria-describedby={hint} value={value} onChange={(e) => onChange(e.target.value)} rows={Math.min(10, Math.max(3, value.split("\n").length))} className="font-mono text-xs" spellCheck={false} />
        : <Input id={id} aria-describedby={hint} value={value} onChange={(e) => onChange(e.target.value)} inputMode={type === "number" ? "decimal" : undefined} className="text-sm" />}
      {description && <p id={hint} className="text-pretty text-[11px] text-muted-foreground">{description}</p>}
    </div>
  );
}
