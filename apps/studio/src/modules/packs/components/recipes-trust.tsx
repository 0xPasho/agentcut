"use client";
import { useState } from "react";
import { Code2, Loader2, ShieldAlert, ShieldCheck } from "lucide-react";
import { api } from "@agentcut/core/common/api/client";
import { Button } from "@/common/ui/button";
import type { InstalledPack } from "@agentcut/core/modules/packs/types";

/**
 * A pack's recipes on its page (decision 143): what each one does, the code in full,
 * and the one control that lets it run on this machine. Trusting is recorded against
 * the code's hash, so a re-import that changes a byte asks again.
 */
export function RecipesTrust({ pack, pending, onTrust }: { pack: InstalledPack; pending: boolean; onTrust: (trust: boolean) => void }) {
  const [sources, setSources] = useState<Array<{ file: string; bytes: number; text: string | null }> | null>(null);
  const [error, setError] = useState("");
  const trusted = !!pack.recipesHash && pack.trustedRecipesHash === pack.recipesHash;

  const readCode = async () => {
    if (sources) return setSources(null);
    try { setSources(await api.workspace({ action: "packs.recipes.source", id: pack.id })); setError(""); }
    catch (reason) { setError((reason as Error).message); }
  };

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-2">
        {pack.recipes.map((recipe) => (
          <li key={recipe.id} className="rounded-xl bg-foreground/[0.04] px-3 py-2.5">
            <p className="text-sm font-medium">{recipe.label} <span className="font-mono text-xs font-normal text-muted-foreground">{recipe.id}</span></p>
            {recipe.description && <p className="mt-0.5 text-pretty text-xs text-muted-foreground">{recipe.description}</p>}
            {!!Object.keys(recipe.params).length && (
              <p className="mt-1 text-xs text-muted-foreground">Takes {Object.entries(recipe.params).map(([name, p]) => `${name}${p.required ? "" : "?"}`).join(", ")}</p>
            )}
          </li>
        ))}
      </ul>

      <div className={`flex flex-wrap items-center gap-3 rounded-xl px-3 py-2.5 text-sm ring-1 ${trusted ? "ring-emerald-500/30" : "ring-amber-500/30"}`}>
        {trusted ? <ShieldCheck aria-hidden className="size-4 shrink-0 text-emerald-500" /> : <ShieldAlert aria-hidden className="size-4 shrink-0 text-amber-500" />}
        <p className="min-w-0 flex-1 text-pretty">
          {trusted
            ? "Trusted on this machine. Its recipes can edit your projects through the editor's tools, from the editor, the agent or the terminal."
            : "Not trusted. This is code: read it, and trust it only if you would run it yourself. It runs sandboxed — its own folder, fonts, no network — and edits only through the editor's tools."}
          <span className="block font-mono text-[11px] text-muted-foreground">sha256 {pack.recipesHash.slice(0, 16)}…</span>
        </p>
        <Button size="sm" variant="ghost" onClick={() => void readCode()}><Code2 aria-hidden />{sources ? "Hide the code" : "Read the code"}</Button>
        <Button size="sm" variant={trusted ? "outline" : "default"} disabled={pending} onClick={() => onTrust(!trusted)}>
          {pending && <Loader2 aria-hidden className="motion-safe:animate-spin" />}{trusted ? "Stop trusting" : "Trust this code"}
        </Button>
      </div>

      {sources && (
        <div className="flex flex-col gap-3">
          {sources.map((source) => (
            <div key={source.file} className="flex flex-col gap-1">
              <p className="font-mono text-xs text-muted-foreground">{source.file} <span className="tabular-nums">({source.bytes.toLocaleString()} bytes)</span></p>
              {source.text !== null
                ? <pre className="max-h-80 overflow-auto rounded-xl bg-black/40 p-3 font-mono text-[11px] leading-relaxed">{source.text}</pre>
                : <p className="text-xs text-muted-foreground">Binary file, not shown.</p>}
            </div>
          ))}
        </div>
      )}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
