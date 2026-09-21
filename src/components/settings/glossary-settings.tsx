"use client";
import { useEffect, useId, useMemo, useState } from "react";
import { Loader2, Plus, Search, Trash2 } from "lucide-react";
import { api } from "@/lib/client";
import type { Glossary, GlossaryTerm } from "@/lib/glossary";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Empty, SectionHeader } from "./section-header";
import { useWorkspaceSettings } from "./use-workspace";

/**
 * The glossary: a spelling, the ways a recogniser gets it wrong, and one line of
 * what the thing is. Deterministic — it feeds the recogniser's vocabulary hint, the
 * proofreader and a find-and-replace over the transcript — which is why it is a
 * table and not a rule.
 *
 * One save for the list, because `glossary.save` writes a level whole; a per-row
 * save would be the same write wearing a smaller button, and two rows edited with
 * one saved would quietly save both.
 */
type Row = { term: string; aliases: string; note: string; brand?: GlossaryTerm["brand"] };

const toRows = (glossary: Glossary): Row[] =>
  glossary.terms.map((t) => ({ term: t.term, aliases: t.aliases.join(", "), note: t.note, brand: t.brand }));

export const rowsToGlossary = (rows: Row[]): Glossary => ({
  terms: rows
    .filter((r) => r.term.trim())
    .map((r) => ({
      term: r.term.trim(),
      aliases: r.aliases.split(",").map((a) => a.trim()).filter(Boolean),
      note: r.note.trim(),
      ...(r.brand ? { brand: r.brand } : {}),
    })),
});

export function GlossarySettings() {
  const { data, error, pending, run } = useWorkspaceSettings();
  const id = useId();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [filter, setFilter] = useState("");

  // The server's list is the truth until it is edited; after that the draft is,
  // until it is saved. Reloading after a save brings both back together.
  useEffect(() => { if (data) setRows(toRows(data.glossary)); }, [data]);

  const saved = useMemo(() => (data ? toRows(data.glossary) : []), [data]);
  const dirty = !!rows && JSON.stringify(rows) !== JSON.stringify(saved);
  const shown = (rows ?? []).map((row, index) => ({ row, index }))
    .filter(({ row }) => !filter.trim() || `${row.term} ${row.aliases} ${row.note}`.toLowerCase().includes(filter.trim().toLowerCase()));

  const update = (index: number, patch: Partial<Row>) =>
    setRows((current) => (current ?? []).map((r, i) => (i === index ? { ...r, ...patch } : r)));

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        run("glossary", () => api.workspace({ action: "glossary.save", glossary: rowsToGlossary(rows ?? []) }));
      }}
    >
      <SectionHeader
        title="Glossary"
        action={<Button size="sm" type="button" onClick={() => setRows([...(rows ?? []), { term: "", aliases: "", note: "" }])}><Plus />Add term</Button>}
      >
        Names spelled exactly this way in captions, titles and hooks. The recogniser gets them as a
        hint before it listens, and anything it still mishears is corrected afterwards.
      </SectionHeader>

      {!rows ? (
        <p className="text-sm text-muted-foreground">Loading your glossary…</p>
      ) : rows.length ? (
        <>
          {rows.length > 8 && (
            <div className="relative">
              <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input aria-label="Filter terms" className="pl-9" placeholder="Filter terms" value={filter} onChange={(e) => setFilter(e.target.value)} />
            </div>
          )}
          <ul className="flex flex-col gap-2">
            {shown.map(({ row, index }) => (
              <li key={index} className="grid gap-3 rounded-2xl bg-card px-4 py-3.5 ring-1 ring-foreground/10 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.3fr)_auto] sm:items-end">
                <div className="space-y-1">
                  <Label htmlFor={`${id}-term-${index}`} className="text-xs text-muted-foreground">Spelled</Label>
                  <Input id={`${id}-term-${index}`} value={row.term} placeholder="Claude" onChange={(e) => update(index, { term: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`${id}-aliases-${index}`} className="text-xs text-muted-foreground">Heard as</Label>
                  <Input id={`${id}-aliases-${index}`} value={row.aliases} placeholder="clod, cloud AI" onChange={(e) => update(index, { aliases: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`${id}-note-${index}`} className="text-xs text-muted-foreground">What it is</Label>
                  <Input id={`${id}-note-${index}`} value={row.note} placeholder="Anthropic's model" onChange={(e) => update(index, { note: e.target.value })} />
                </div>
                <Button
                  type="button" size="icon" variant="ghost" className="justify-self-end"
                  aria-label={`Remove ${row.term || "this term"}`}
                  onClick={() => setRows((current) => (current ?? []).filter((_, i) => i !== index))}
                ><Trash2 /></Button>
              </li>
            ))}
          </ul>
          {filter.trim() && !shown.length && (
            <p className="text-sm text-muted-foreground">
              No term matches “{filter.trim()}”.{" "}
              <button type="button" className="underline underline-offset-2" onClick={() => setFilter("")}>Clear the filter</button>
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Separate the mishearings with commas. A term with capitals also fixes its own lowercase, so
            “Claude” catches “claude” without being listed twice.
          </p>
        </>
      ) : (
        <Empty
          title="No names yet"
          action={<Button size="sm" type="button" className="mt-2" onClick={() => setRows([{ term: "", aliases: "", note: "" }])}><Plus />Add term</Button>}
        >
          Add the names a speech recogniser gets wrong — your product, your handle, the people you
          mention. Every agent is told to spell them this way.
        </Empty>
      )}

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {dirty && (
        <div className="sticky bottom-4 flex flex-wrap items-center gap-3 rounded-2xl bg-card px-4 py-3 ring-1 ring-primary/40">
          <p className="min-w-0 flex-1 text-sm">Unsaved changes</p>
          <Button type="button" variant="ghost" size="sm" onClick={() => setRows(saved)}>Discard</Button>
          <Button type="submit" size="sm" disabled={pending === "glossary"}>
            {pending === "glossary" && <Loader2 aria-hidden className="motion-safe:animate-spin" />}Save glossary
          </Button>
        </div>
      )}
    </form>
  );
}
