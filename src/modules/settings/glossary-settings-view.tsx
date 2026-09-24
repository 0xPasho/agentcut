"use client";
import { useEffect, useId, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, Palette, Plus, Search, Trash2 } from "lucide-react";
import { api } from "@/common/api/client";
import type { Glossary, GlossaryTerm } from "@/modules/rules/server/glossary";
import { Button } from "@/common/ui/button";
import { Input } from "@/common/ui/input";
import { Label } from "@/common/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/common/ui/tabs";
import { Glass } from "@/common/ui/glass";
import { Empty, ErrorLine, Loading, Panel, SectionHeader } from "./components/section-header";
import { SubjectForm, Swatches } from "./components/subject-form";
import { useWorkspaceSettings } from "./hooks";
import { type Row } from "./types";
import { toRows, rowsToGlossary, count } from "./lib";
import { EMPTY_KIT } from "./data";

/**
 * One list (decision 132). Every name the recogniser must get right is a row; a
 * row that has been given a look — colours, fonts, a logo — is a subject (decision
 * 48), shown with its swatches and filterable on its own. The spelling, the
 * mishearings and the one line of what it is are the same fields either way, and
 * the two writers (the table's save and the look's form) both call `glossary.save`
 * with the whole level, which is what the tool writes.
 */
export function GlossarySettings() {
  const { data, error, pending, run, setError } = useWorkspaceSettings();
  const id = useId();
  const router = useRouter();
  const params = useSearchParams();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [filter, setFilter] = useState("");
  const [look, setLook] = useState<{ term: GlossaryTerm; isNew: boolean } | null>(null);

  // The filter is the URL, so /settings/subjects lands here with subjects showing and
  // the back button undoes the choice.
  const show: "all" | "subjects" = params.get("show") === "subjects" ? "subjects" : "all";
  const setShow = (next: "all" | "subjects") => router.replace(next === "subjects" ? "/settings/glossary?show=subjects" : "/settings/glossary");

  // The server's list is the truth until it is edited; after that the draft is,
  // until it is saved. Reloading after a save brings both back together.
  useEffect(() => { if (data) setRows(toRows(data.glossary)); }, [data]);

  const saved = useMemo(() => (data ? toRows(data.glossary) : []), [data]);
  const dirty = !!rows && JSON.stringify(rows) !== JSON.stringify(saved);
  const subjects = (rows ?? []).filter((r) => r.brand).length;
  const needle = filter.trim().toLowerCase();
  const shown = (rows ?? []).map((row, index) => ({ row, index }))
    .filter(({ row }) => show === "all" || row.brand)
    .filter(({ row }) => !needle || `${row.term} ${row.aliases} ${row.note}`.toLowerCase().includes(needle));

  const update = (index: number, patch: Partial<Row>) =>
    setRows((current) => (current ?? []).map((r, i) => (i === index ? { ...r, ...patch } : r)));

  const termOf = (row: Row, brand: GlossaryTerm["brand"]): GlossaryTerm =>
    ({ term: row.term, aliases: row.aliases.split(",").map((a) => a.trim()).filter(Boolean), note: row.note, brand });

  /** Writing one look is writing the glossary: the saved list, with this term replaced or added. */
  const saveLook = (term: GlossaryTerm, replacing?: string) => {
    const terms = data?.glossary.terms ?? [];
    const key = (replacing ?? term.term).toLowerCase();
    const next: Glossary = {
      terms: terms.some((t) => t.term.toLowerCase() === key) ? terms.map((t) => (t.term.toLowerCase() === key ? term : t)) : [...terms, term],
    };
    return run(`look:${term.term}`, async () => {
      await api.workspace({ action: "glossary.save", glossary: next });
      setLook(null);
    });
  };

  if (look) {
    return (
      <SubjectForm
        initial={look.term}
        isNew={look.isNew}
        rules={(data?.rules ?? []).filter((r) => r.subject?.toLowerCase() === look.term.term.toLowerCase())}
        images={(data?.assets ?? []).filter((a) => a.kind === "image")}
        pending={pending.startsWith("look:")}
        error={error}
        onCancel={() => { setLook(null); setError(""); }}
        onSave={(term) => saveLook(term, look.isNew ? undefined : look.term.term)}
        // Only a term that has a look can lose it.
        onForget={look.isNew || !look.term.brand ? undefined : () => saveLook({ term: look.term.term, aliases: look.term.aliases, note: look.term.note }, look.term.term)}
      />
    );
  }

  const addName = <Button size="sm" type="button" variant="outline" onClick={() => { setShow("all"); setFilter(""); setRows([...(rows ?? []), { term: "", aliases: "", note: "" }]); }}><Plus />Add name</Button>;
  const newSubject = <Button size="sm" type="button" variant="outline" disabled={dirty} onClick={() => setLook({ term: { term: "", aliases: [], note: "", brand: EMPTY_KIT }, isNew: true })}><Palette />New subject</Button>;

  let list: React.ReactNode = <Loading label="Loading your glossary" />;
  if (rows && rows.length === 0) list = (
    <Empty title="No names yet" action={addName}>
      Add the names a speech recogniser gets wrong — your product, your handle, the people you
      mention. Every agent is told to spell them this way.
    </Empty>
  );
  if (rows && rows.length > 0) list = (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <Tabs value={show} onValueChange={(v) => setShow(v as "all" | "subjects")}>
          <TabsList aria-label="Which names to show">
            <TabsTrigger value="all">All <span className="ms-1 tabular-nums text-muted-foreground">{rows.length}</span></TabsTrigger>
            <TabsTrigger value="subjects">Subjects <span className="ms-1 tabular-nums text-muted-foreground">{subjects}</span></TabsTrigger>
          </TabsList>
        </Tabs>
        {rows.length > 8 && (
          <div className="relative min-w-0 flex-1 sm:max-w-xs">
            <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            {/* Enter here narrows the list; it never saves the glossary. */}
            <Input type="search" aria-label="Filter names" className="pl-9" placeholder="Filter names" value={filter}
              onChange={(e) => setFilter(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }} />
          </div>
        )}
      </div>

      {shown.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {needle && <>No name matches “{filter.trim()}”. <button type="button" className="underline underline-offset-2" onClick={() => setFilter("")}>Clear the filter</button></>}
          {!needle && "No subjects yet. Give a name a look, and it shows here."}
        </p>
      )}
      {shown.length > 0 && (
        <ul className="flex flex-col gap-2">
          {shown.map(({ row, index }) => (
            <Panel as="li" key={index} className="grid gap-3 py-3.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.3fr)_auto] sm:items-end">
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
              <div className="flex items-center gap-1 justify-self-end sm:pb-0.5">
                {row.brand && (
                  <Button type="button" size="xs" variant="outline" className="gap-1.5" disabled={dirty || !row.term.trim()}
                    onClick={() => setLook({ term: termOf(row, row.brand), isNew: false })}>
                    <Swatches kit={row.brand} small />Subject
                  </Button>
                )}
                {!row.brand && (
                  <Button type="button" size="xs" variant="ghost" className="text-muted-foreground" disabled={dirty || !row.term.trim()}
                    onClick={() => setLook({ term: termOf(row, EMPTY_KIT), isNew: false })}>
                    <Palette />Give it a look
                  </Button>
                )}
                <Button
                  type="button" size="icon-sm" variant="ghost"
                  aria-label={`Remove ${row.term || "this name"}`}
                  onClick={() => setRows((current) => (current ?? []).filter((_, i) => i !== index))}
                ><Trash2 /></Button>
              </div>
            </Panel>
          ))}
        </ul>
      )}
      <p className="max-w-prose text-xs text-muted-foreground">
        Separate the mishearings with commas. A term with capitals also fixes its own lowercase, so
        “Claude” catches “claude” without being listed twice. {subjects ? `${count(subjects, "name")} ${subjects === 1 ? "has" : "have"} a look of ${subjects === 1 ? "its" : "their"} own.` : ""}
      </p>
    </>
  );

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        run("glossary", () => api.workspace({ action: "glossary.save", glossary: rowsToGlossary(rows ?? []) }));
      }}
    >
      <SectionHeader title="Glossary" action={rows?.length ? <>{addName}{newSubject}</> : undefined}>
        Names the captions must spell right. Give one a look and projects about it start from its colours.
      </SectionHeader>

      {list}

      <ErrorLine>{error}</ErrorLine>
      {dirty && (
        // The one floating control panel on the page, so it is glass, like the header.
        <Glass shape="card" className="sticky bottom-4 flex flex-wrap items-center gap-3 px-4 py-3">
          <p className="min-w-0 flex-1 text-sm">Unsaved changes <span className="text-muted-foreground">— save the list before giving a name a look.</span></p>
          <Button type="button" variant="ghost" size="sm" onClick={() => setRows(saved)}>Discard</Button>
          <Button type="submit" size="sm" disabled={pending === "glossary"}>
            {pending === "glossary" && <Loader2 aria-hidden className="motion-safe:animate-spin" />}Save glossary
          </Button>
        </Glass>
      )}
    </form>
  );
}
