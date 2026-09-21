"use client";
import { useEffect, useId, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Plus, Trash2 } from "lucide-react";
import { api, type AssetSummary } from "@/lib/client";
import type { Glossary, GlossaryTerm } from "@/lib/glossary";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Empty, SectionHeader } from "./section-header";
import { useWorkspaceSettings } from "./use-workspace";

/**
 * Subjects (decision 48): the things you talk about often — a game, a channel, a
 * person, a product. A subject is a glossary term that has been given a look, which
 * is why it is not a second list to keep in step: the spelling, the mishearings and
 * the one line of what it is are the glossary's, and this page adds the brand kit.
 *
 * A project whose plan names the subject inherits that kit when the plan is applied,
 * under any override the project or a rule sets. A rule can say it is about the
 * subject, and those rules are listed here so a subject reads as one thing.
 *
 * Not modelled yet: assets that belong to a subject. A library image named after it
 * is still found by name, which is how the picture search has always worked.
 */
const EMPTY_KIT: NonNullable<GlossaryTerm["brand"]> = {
  palette: { primary: "", secondary: "", text: "", background: "" },
  fonts: { captions: "", titles: "" },
  logo: { slot: "", assetId: "" },
};

export function SubjectsSettings() {
  const { data, error, pending, run, setError } = useWorkspaceSettings();
  const [editing, setEditing] = useState<{ term: GlossaryTerm; isNew: boolean } | null>(null);
  const [images, setImages] = useState<AssetSummary[]>([]);

  useEffect(() => { void api.listAssets("image", "").then((r) => setImages(r.assets)).catch(() => setImages([])); }, []);

  const terms = data?.glossary.terms ?? [];
  const subjects = terms.filter((t) => t.brand);
  const plain = terms.filter((t) => !t.brand);

  /** Writing one subject is writing the glossary: the same list, with this term replaced. */
  const save = (term: GlossaryTerm, replacing?: string) => {
    const key = (replacing ?? term.term).toLowerCase();
    const next: Glossary = {
      terms: terms.some((t) => t.term.toLowerCase() === key)
        ? terms.map((t) => (t.term.toLowerCase() === key ? term : t))
        : [...terms, term],
    };
    return run(`save:${term.term}`, async () => {
      await api.workspace({ action: "glossary.save", glossary: next });
      setEditing(null);
    });
  };

  const forget = (term: GlossaryTerm) =>
    run(`forget:${term.term}`, () => api.workspace({
      action: "glossary.save",
      glossary: { terms: terms.map((t) => (t.term === term.term ? { term: t.term, aliases: t.aliases, note: t.note } : t)) },
    }));

  if (editing) {
    return (
      <SubjectForm
        initial={editing.term}
        isNew={editing.isNew}
        images={images}
        rules={(data?.rules ?? []).filter((r) => r.subject?.toLowerCase() === editing.term.term.toLowerCase())}
        pending={pending.startsWith("save:")}
        error={error}
        onCancel={() => { setEditing(null); setError(""); }}
        onSave={(term) => save(term, editing.term.term)}
      />
    );
  }

  return (
    <section className="flex flex-col gap-5">
      <SectionHeader
        title="Subjects"
        action={<Button size="sm" onClick={() => setEditing({ term: { term: "", aliases: [], note: "", brand: EMPTY_KIT }, isNew: true })}><Plus />New subject</Button>}
      >
        A subject is something you talk about often, with the look that belongs to it. Name it once and
        a project about it starts with its colours, its fonts and its logo.
      </SectionHeader>

      {!data ? (
        <p className="text-sm text-muted-foreground">Loading your subjects…</p>
      ) : subjects.length ? (
        <ul className="flex flex-col gap-2">
          {subjects.map((subject) => {
            const rules = (data.rules ?? []).filter((r) => r.subject?.toLowerCase() === subject.term.toLowerCase());
            return (
              <li key={subject.term} className="flex flex-wrap items-center gap-x-3 gap-y-3 rounded-2xl bg-card px-4 py-3.5 ring-1 ring-foreground/10">
                <Swatches kit={subject.brand!} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{subject.term}</p>
                  <p className="text-xs text-muted-foreground">
                    {[subject.note, rules.length ? `${rules.length} rule${rules.length === 1 ? "" : "s"} about it` : ""].filter(Boolean).join(" · ") || "No description yet"}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button size="xs" variant="outline" onClick={() => setEditing({ term: subject, isNew: false })}>Edit</Button>
                  <ForgetSubject subject={subject} pending={pending === `forget:${subject.term}`} onForget={() => forget(subject)} />
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <Empty
          title="No subjects yet"
          action={<Button size="sm" className="mt-2" onClick={() => setEditing({ term: { term: "", aliases: [], note: "", brand: EMPTY_KIT }, isNew: true })}><Plus />New subject</Button>}
        >
          Most people do not have a product. They do have a game, a channel or a person they mention in
          every video and want spelled and coloured the same way every time.
        </Empty>
      )}

      {!!plain.length && (
        <div className="flex flex-col gap-2 rounded-2xl bg-card px-4 py-3.5 ring-1 ring-foreground/10">
          <h3 className="text-sm font-medium">Make a subject out of a name you already have</h3>
          <p className="text-xs text-muted-foreground">
            These are in your glossary with no look of their own. Giving one a colour or a logo makes it a subject.
          </p>
          <ul className="flex flex-wrap gap-2 pt-1">
            {plain.map((term) => (
              <li key={term.term}>
                <Button size="xs" variant="outline" onClick={() => setEditing({ term: { ...term, brand: EMPTY_KIT }, isNew: false })}>
                  {term.term}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </section>
  );
}

function Swatches({ kit }: { kit: NonNullable<GlossaryTerm["brand"]> }) {
  const colours = [kit.palette.primary, kit.palette.secondary, kit.palette.text, kit.palette.background].filter(Boolean);
  if (!colours.length) return <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-xl bg-foreground/5 text-xs text-muted-foreground">—</span>;
  return (
    <span aria-hidden className="flex size-9 shrink-0 flex-wrap overflow-hidden rounded-xl ring-1 ring-foreground/10">
      {colours.map((colour, i) => (
        <span key={i} className="h-1/2 w-1/2 grow" style={{ background: colour, minWidth: colours.length === 1 ? "100%" : undefined, height: colours.length <= 2 ? "100%" : undefined }} />
      ))}
    </span>
  );
}

function ForgetSubject({ subject, pending, onForget }: { subject: GlossaryTerm; pending: boolean; onForget: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="xs" variant="ghost" aria-label={`Remove the look for ${subject.term}`} />}>
        <Trash2 aria-hidden />
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove this subject&apos;s look?</DialogTitle>
          <DialogDescription>
            “{subject.term}” stays in your glossary and keeps being spelled the same way. Only its colours,
            fonts and logo go. Videos already made with them do not change.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button variant="destructive" disabled={pending} onClick={() => { onForget(); setOpen(false); }}>
            {pending && <Loader2 aria-hidden className="motion-safe:animate-spin" />}Remove the look
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Colour({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs text-muted-foreground">{label}</Label>
      <div className="flex items-center gap-2">
        <Input id={id} value={value} placeholder="#ffda2a" className="font-mono" onChange={(e) => onChange(e.target.value)} />
        <input
          type="color"
          aria-label={`Pick ${label.toLowerCase()}`}
          value={/^#[0-9a-f]{6}$/i.test(value) ? value : "#000000"}
          onChange={(e) => onChange(e.target.value)}
          className="size-9 shrink-0 cursor-pointer rounded-lg bg-transparent ring-1 ring-foreground/15 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        />
      </div>
    </div>
  );
}

function SubjectForm({ initial, isNew, images, rules, pending, error, onSave, onCancel }: {
  initial: GlossaryTerm; isNew: boolean; images: AssetSummary[];
  rules: Array<{ id: string; name: string }>; pending: boolean; error: string;
  onSave: (term: GlossaryTerm) => void; onCancel: () => void;
}) {
  const id = useId();
  const [term, setTerm] = useState(initial.term);
  const [aliases, setAliases] = useState(initial.aliases.join(", "));
  const [note, setNote] = useState(initial.note);
  const [kit, setKit] = useState(initial.brand ?? EMPTY_KIT);
  const palette = (patch: Partial<typeof kit.palette>) => setKit({ ...kit, palette: { ...kit.palette, ...patch } });

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({
          term: term.trim(),
          aliases: aliases.split(",").map((a) => a.trim()).filter(Boolean),
          note: note.trim(),
          brand: kit,
        });
      }}
    >
      <div className="flex items-center gap-2">
        <Button type="button" size="icon-sm" variant="ghost" aria-label="Back to subjects" onClick={onCancel}><ArrowLeft /></Button>
        <h2 className="font-heading text-xl tracking-[-0.02em]">{isNew ? "New subject" : term || "Edit subject"}</h2>
      </div>

      <fieldset className="flex flex-col gap-4 rounded-2xl bg-card px-4 py-4 ring-1 ring-foreground/10">
        <legend className="sr-only">What it is</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-term`}>Name</Label>
            <Input id={`${id}-term`} required value={term} placeholder="Deska" onChange={(e) => setTerm(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-aliases`}>Heard as</Label>
            <Input id={`${id}-aliases`} value={aliases} placeholder="desk app, deska app" aria-describedby={`${id}-aliases-help`} onChange={(e) => setAliases(e.target.value)} />
            <p id={`${id}-aliases-help`} className="text-xs text-muted-foreground">Comma separated. The recogniser&apos;s mistakes, corrected in captions.</p>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-note`}>What it is</Label>
          <Input id={`${id}-note`} value={note} placeholder="Desktop app for designers" aria-describedby={`${id}-note-help`} onChange={(e) => setNote(e.target.value)} />
          <p id={`${id}-note-help`} className="text-xs text-muted-foreground">One line. Every agent reads it before it writes a title or a hook.</p>
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-4 rounded-2xl bg-card px-4 py-4 ring-1 ring-foreground/10">
        <legend className="sr-only">How it looks</legend>
        <div>
          <h3 className="text-sm font-medium">How it looks</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            A project whose plan names this subject starts from these. Anything the project or a rule
            sets wins over them, so this is a starting point, not a lock.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Colour id={`${id}-primary`} label="Highlight" value={kit.palette.primary} onChange={(primary) => palette({ primary })} />
          <Colour id={`${id}-secondary`} label="Second colour" value={kit.palette.secondary} onChange={(secondary) => palette({ secondary })} />
          <Colour id={`${id}-text`} label="Caption text" value={kit.palette.text} onChange={(text) => palette({ text })} />
          <Colour id={`${id}-background`} label="Background" value={kit.palette.background} onChange={(background) => palette({ background })} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-captions-font`} className="text-xs text-muted-foreground">Caption font</Label>
            <Input id={`${id}-captions-font`} value={kit.fonts.captions} placeholder="Inter" onChange={(e) => setKit({ ...kit, fonts: { ...kit.fonts, captions: e.target.value } })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-titles-font`} className="text-xs text-muted-foreground">Title font</Label>
            <Input id={`${id}-titles-font`} value={kit.fonts.titles} placeholder="Inter" onChange={(e) => setKit({ ...kit, fonts: { ...kit.fonts, titles: e.target.value } })} />
          </div>
        </div>
        <div className="space-y-1.5">
          <span id={`${id}-logo`} className="text-xs text-muted-foreground">Logo</span>
          <Select value={kit.logo.assetId} onValueChange={(v) => setKit({ ...kit, logo: { ...kit.logo, assetId: String(v) } })}>
            <SelectTrigger aria-labelledby={`${id}-logo`} aria-describedby={`${id}-logo-help`} className="w-full">
              <SelectValue>{(v: unknown) => images.find((a) => a.id === v)?.name ?? "No logo"}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">No logo</SelectItem>
              {images.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <p id={`${id}-logo-help`} className="text-xs text-muted-foreground">
            An image from your library. It becomes the watermark on templates that ask for one.{" "}
            <Link href="/library" className="underline underline-offset-2">Add images to your library</Link>.
          </p>
        </div>
      </fieldset>

      {!!rules.length && (
        <div className="flex flex-col gap-2 rounded-2xl bg-card px-4 py-3.5 ring-1 ring-foreground/10">
          <h3 className="text-sm font-medium">Rules about {term}</h3>
          <ul className="text-sm text-muted-foreground">{rules.map((r) => <li key={r.id}>{r.name}</li>)}</ul>
          <Link href="/settings/rules" className="text-xs underline underline-offset-2">Open your rules</Link>
        </div>
      )}

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>{pending && <Loader2 aria-hidden className="motion-safe:animate-spin" />}Save subject</Button>
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}
