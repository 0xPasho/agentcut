"use client";
import { useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { BookOpen, ChevronRight, Palette, Plus, Search } from "lucide-react";
import { api } from "@agentcut/core/common/api/client";
import type { GlossaryTerm } from "@agentcut/core/modules/rules/types";
import { Button } from "@/common/ui/button";
import { Input } from "@/common/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/common/ui/tabs";
import { Empty, ErrorLine, Loading, SectionHeader } from "./components/section-header";
import { SubjectForm, Swatches } from "./components/subject-form";
import { GlossaryNameDialog } from "./components/glossary-name-dialog";
import { useWorkspaceSettings } from "./hooks";
import type { GlossarySelection } from "@agentcut/core/modules/settings/types";
import { count } from "@agentcut/core/modules/settings/lib";
import { EMPTY_KIT } from "@agentcut/core/modules/settings/data";

/** One list, one active draft, and the same whole-level glossary.save as the agent. */
export function GlossarySettings() {
  const { data, error, reload } = useWorkspaceSettings();
  const router = useRouter();
  const params = useSearchParams();
  const [filter, setFilter] = useState("");
  const [editing, setEditing] = useState<GlossarySelection | null>(null);
  const [look, setLook] = useState<GlossarySelection | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [saveError, setSaveError] = useState("");
  const [notice, setNotice] = useState("");
  const returnFocus = useRef<HTMLElement | null>(null);
  const addNameRef = useRef<HTMLButtonElement | null>(null);
  const show = params.get("show") === "subjects" ? "subjects" : "all";
  const terms = data?.glossary.terms ?? [];
  const subjects = terms.filter((term) => term.brand).length;
  const needle = filter.trim().toLowerCase();
  const shown = terms.map((term, index) => ({ term, index }))
    .filter(({ term }) => show === "all" || term.brand)
    .filter(({ term }) => !needle || `${term.term} ${term.aliases.join(" ")} ${term.note}`.toLowerCase().includes(needle));

  const openName = (selection: GlossarySelection) => {
    returnFocus.current = document.activeElement as HTMLElement;
    setSaveError("");
    setNotice("");
    setEditing(selection);
  };
  const closeName = () => {
    setEditing(null);
    requestAnimationFrame(() => {
      const target = returnFocus.current?.isConnected ? returnFocus.current : addNameRef.current;
      target?.focus();
    });
  };
  const openLook = (selection: GlossarySelection) => {
    setSaveError("");
    setLook(selection);
  };
  const save = async (selection: GlossarySelection, term: GlossaryTerm | null) => {
    if (savingRef.current || !data) return;
    savingRef.current = true;
    setSaving(true);
    setSaveError("");
    let next = terms.filter((_, index) => index !== selection.index);
    if (term && selection.index === null) next = [...terms, term];
    if (term && selection.index !== null) next = terms.map((current, index) => index === selection.index ? term : current);
    try {
      await api.workspace({ action: "glossary.save", glossary: { terms: next } });
      await reload();
      if (term && selection.index === null) {
        setFilter("");
        if (!term.brand) router.replace("/settings/glossary", { scroll: false });
      }
      closeName();
      setLook(null);
      setNotice(term ? `Saved ${term.term}.` : `Removed ${selection.term.term}.`);
    } catch (e) {
      setSaveError((e as Error).message);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  if (look) return (
    <SubjectForm
      initial={look.term} isNew={look.index === null}
      rules={(data?.rules ?? []).filter((rule) => rule.subject?.toLowerCase() === look.term.term.toLowerCase())}
      images={(data?.assets ?? []).filter((asset) => asset.kind === "image")}
      pending={saving} error={saveError}
      onCancel={() => { if (!saving) setLook(null); }}
      onSave={(term) => void save(look, term)}
      onForget={look.index === null || !look.term.brand ? undefined : () => void save(look, { term: look.term.term, aliases: look.term.aliases, note: look.term.note })}
    />
  );

  const addName = <Button ref={addNameRef} type="button" disabled={!data} onClick={() => openName({ term: { term: "", aliases: [], note: "" }, index: null })}><Plus aria-hidden />Add name</Button>;
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <SectionHeader title="Glossary" action={addName}>
        The right spelling for every name, in every project.
      </SectionHeader>
      <ErrorLine>{error}</ErrorLine>
      {!data && !error && <Loading label="Loading your glossary" />}
      {data && terms.length === 0 && (
        <Empty title="Get the names right">
          Add people, products and phrases your captions should spell correctly, along with the ways they are misheard.
        </Empty>
      )}
      {data && terms.length > 0 && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Tabs value={show} onValueChange={(value) => router.replace(value === "subjects" ? "/settings/glossary?show=subjects" : "/settings/glossary", { scroll: false })}>
              <TabsList aria-label="Filter names">
                <TabsTrigger value="all">All names <span className="ms-1 text-muted-foreground tabular-nums">{terms.length}</span></TabsTrigger>
                <TabsTrigger value="subjects">Subjects <span className="ms-1 text-muted-foreground tabular-nums">{subjects}</span></TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="relative w-full sm:w-72">
              <Search aria-hidden className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input type="search" aria-label="Search names, variants and descriptions" className="ps-9" placeholder="Search names and variants…" value={filter} onChange={(e) => setFilter(e.target.value)} />
            </div>
          </div>
          {shown.length > 0 && (
            <div className="overflow-hidden rounded-3xl bg-card ring-1 ring-foreground/10">
              <div aria-hidden className="hidden grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1.5fr)_1rem] gap-6 border-b border-foreground/10 px-5 py-3 text-xs font-medium text-muted-foreground lg:grid">
                <span>Correct spelling</span><span>Heard as</span><span>Context</span><span />
              </div>
              <ul className="divide-y divide-foreground/10">
                {shown.map(({ term, index }) => (
                  <li key={index}>
                    <button type="button" aria-label={`Edit ${term.term}`} onClick={() => openName({ term, index })}
                      className="group grid w-full grid-cols-[minmax(0,1fr)_1rem] items-center gap-x-6 gap-y-1 px-5 py-4 text-start transition-colors hover:bg-foreground/5 focus-visible:bg-foreground/5 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1.5fr)_1rem]">
                      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium wrap-anywhere">
                        {term.term}
                        {term.brand && <span className="inline-flex items-center gap-1.5 rounded-full bg-foreground/5 px-2 py-0.5 text-xs font-normal text-muted-foreground"><Swatches kit={term.brand} small />Subject</span>}
                      </span>
                      <span className="col-start-1 row-start-2 text-sm leading-relaxed text-muted-foreground wrap-anywhere lg:col-auto lg:row-auto">
                        {term.aliases.length > 0 ? term.aliases.join(", ") : <span className="hidden lg:inline">—</span>}
                      </span>
                      <span className="col-start-1 row-start-3 text-sm leading-relaxed text-muted-foreground wrap-anywhere lg:col-auto lg:row-auto">
                        {term.note || <span className="hidden lg:inline">—</span>}
                      </span>
                      <ChevronRight aria-hidden className="col-start-2 row-start-1 size-4 text-muted-foreground group-hover:text-foreground lg:col-auto lg:row-auto" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {shown.length === 0 && needle && <Empty title="No matching names" action={<Button variant="outline" onClick={() => setFilter("")}>Clear search</Button>}>No names, variants or descriptions match “{filter.trim()}”.</Empty>}
          {shown.length === 0 && !needle && <Empty title="Give a name its own look" action={<Button variant="outline" onClick={() => router.replace("/settings/glossary", { scroll: false })}>Browse names</Button>}>Subjects are names with colours, fonts or a logo. Open a name to add its look.</Empty>}
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
            <p role="status" className="tabular-nums">{count(shown.length, "name")}{needle && ` matching “${filter.trim()}”`}</p>
            <Button type="button" size="sm" variant="ghost" onClick={() => openLook({ term: { term: "", aliases: [], note: "", brand: EMPTY_KIT }, index: null })}><Palette aria-hidden />New subject</Button>
          </div>
        </div>
      )}
      <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground"><BookOpen aria-hidden className="mt-0.5 size-3.5 shrink-0" />Names guide transcription and caption corrections. Add a look to make a name a subject.</p>
      <p role="status" className="text-sm text-muted-foreground">{notice}</p>
      {editing && <GlossaryNameDialog selection={editing} pending={saving} error={saveError} onClose={closeName} onSave={(term) => void save(editing, term)} onLook={() => { setEditing(null); openLook(editing); }} />}
    </div>
  );
}
