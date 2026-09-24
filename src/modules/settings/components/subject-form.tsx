"use client";
import { useId, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Trash2 } from "lucide-react";
import type { GlossaryTerm } from "@/modules/rules/server/glossary";
import { Button } from "@/common/ui/button";
import { ColorField } from "@/common/ui/color-field";
import { Input } from "@/common/ui/input";
import { Label } from "@/common/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/common/ui/select";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/common/ui/dialog";
import { ErrorLine, Panel, PanelHeading, SectionHeader } from "./section-header";
import { EMPTY_KIT } from "../data";
import type { AssetOption } from "../types";

/** The colours of a kit as one tile, so a subject is recognised before its name is read. */
export function Swatches({ kit, small }: { kit: NonNullable<GlossaryTerm["brand"]>; small?: boolean }) {
  const colours = [kit.palette.primary, kit.palette.secondary, kit.palette.text, kit.palette.background].filter(Boolean);
  const size = small ? "size-6 rounded-lg" : "size-9 rounded-xl";
  if (!colours.length) return <span aria-hidden className={`grid ${size} shrink-0 place-items-center bg-foreground/5 text-xs text-muted-foreground`}>—</span>;
  return (
    <span aria-hidden className={`flex ${size} shrink-0 flex-wrap overflow-hidden ring-1 ring-foreground/10`}>
      {colours.map((colour, i) => (
        <span key={i} className="h-1/2 w-1/2 grow" style={{ background: colour, minWidth: colours.length === 1 ? "100%" : undefined, height: colours.length <= 2 ? "100%" : undefined }} />
      ))}
    </span>
  );
}

function Colour({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs text-muted-foreground">{label}</Label>
      <div className="flex items-center gap-2">
        <Input id={id} value={value} placeholder="#ffda2a" className="font-mono" onChange={(e) => onChange(e.target.value)} />
        <ColorField
          label={`Pick ${label.toLowerCase()}`}
          value={/^#[0-9a-f]{6}$/i.test(value) ? value : "#000000"}
          onChange={onChange}
          side="bottom"
          align="end"
          className="shrink-0"
          swatchClassName="size-8"
        />
      </div>
    </div>
  );
}

/**
 * The look of a subject (decision 48): the same name, mishearings and note as its
 * glossary row, plus the kit a project about it starts from. Saving writes the
 * glossary whole through `glossary.save`; forgetting the look keeps the name.
 */
export function SubjectForm({ initial, isNew, images, rules, pending, error, onSave, onCancel, onForget }: {
  initial: GlossaryTerm; isNew: boolean; images: AssetOption[];
  rules: Array<{ id: string; name: string }>; pending: boolean; error: string;
  onSave: (term: GlossaryTerm) => void; onCancel: () => void; onForget?: () => void;
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
        // A kit with nothing in it is no look at all: the name stays a plain glossary
        // term rather than a colourless subject.
        const filled = [...Object.values(kit.palette), ...Object.values(kit.fonts), kit.logo.assetId].some((v) => v.trim());
        onSave({ term: term.trim(), aliases: aliases.split(",").map((a) => a.trim()).filter(Boolean), note: note.trim(), ...(filled ? { brand: kit } : {}) });
      }}
    >
      <SectionHeader
        title={isNew ? "New subject" : term || "Edit subject"}
        eyebrow={<Button type="button" size="xs" variant="ghost" className="-ms-2" onClick={onCancel}><ArrowLeft />Glossary</Button>}
        action={onForget && <ForgetLook term={term} pending={pending} onForget={onForget} />}
      >
        Something you talk about often, with the look that belongs to it. A project whose plan names it
        starts from these colours, fonts and logo.
      </SectionHeader>

      <Panel as="fieldset" className="flex flex-col gap-4">
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
      </Panel>

      <Panel as="fieldset" className="flex flex-col gap-4">
        <legend className="sr-only">How it looks</legend>
        <PanelHeading title="How it looks" icon={<Swatches kit={kit} small />}>
          A starting point, not a lock: anything the project or a rule sets wins over these.
        </PanelHeading>
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
      </Panel>

      {!!rules.length && (
        <Panel className="flex flex-col gap-2 py-3.5">
          <h3 className="text-sm font-medium">Rules about {term}</h3>
          <ul className="text-sm text-muted-foreground">{rules.map((r) => <li key={r.id}>{r.name}</li>)}</ul>
          <Link href="/settings/rules" className="text-xs underline underline-offset-2">Open your rules</Link>
        </Panel>
      )}

      <ErrorLine>{error}</ErrorLine>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>{pending && <Loader2 aria-hidden className="motion-safe:animate-spin" />}Save subject</Button>
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

function ForgetLook({ term, pending, onForget }: { term: string; pending: boolean; onForget: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button type="button" size="sm" variant="ghost" />}>
        <Trash2 aria-hidden />Remove the look
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove this subject&apos;s look?</DialogTitle>
          <DialogDescription>
            “{term}” stays in your glossary and keeps being spelled the same way. Only its colours,
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
