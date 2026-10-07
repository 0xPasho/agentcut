"use client";
import { useId, useState } from "react";
import { Loader2, Palette, Trash2 } from "lucide-react";
import type { GlossaryTerm } from "@agentcut/core/modules/rules/types";
import type { GlossarySelection } from "@agentcut/core/modules/settings/types";
import { Button } from "@/common/ui/button";
import { Input } from "@/common/ui/input";
import { Textarea } from "@/common/ui/textarea";
import { Label } from "@/common/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/common/ui/dialog";
import { ErrorLine } from "./section-header";
import { Swatches } from "./subject-form";

export function GlossaryNameDialog({ selection, pending, error, onClose, onSave, onLook }: {
  selection: GlossarySelection; pending: boolean; error: string;
  onClose: () => void; onSave: (term: GlossaryTerm | null) => void; onLook: () => void;
}) {
  const id = useId();
  const [name, setName] = useState(selection.term.term);
  const [aliases, setAliases] = useState(selection.term.aliases.join(", "));
  const [note, setNote] = useState(selection.term.note);
  const [removing, setRemoving] = useState(false);
  const dirty = name !== selection.term.term || aliases !== selection.term.aliases.join(", ") || note !== selection.term.note;
  const isNew = selection.index === null;
  let title = isNew ? "Add name" : "Edit name";
  if (removing) title = "Remove this name?";
  const removalDetail = selection.term.brand ? ", along with its look" : "";
  const description = removing
    ? `“${selection.term.term}” and its spelling variants will be removed from the workspace glossary${removalDetail}.`
    : "Set the spelling your captions should use.";
  return (
    <Dialog open onOpenChange={(open) => { if (!open && !pending) onClose(); }}>
      <DialogContent className="sm:max-w-lg" showCloseButton={!pending}>
        <form className="flex flex-col gap-5" onSubmit={(event) => {
          event.preventDefault();
          if (pending) return;
          if (removing) { onSave(null); return; }
          onSave({ ...selection.term, term: name.trim(), aliases: aliases.split(",").map((alias) => alias.trim()).filter(Boolean), note: note.trim() });
        }}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          {!removing && <>
            <fieldset disabled={pending} className="flex min-w-0 flex-col gap-4">
              <div className="space-y-1.5">
                <Label htmlFor={`${id}-name`}>Correct spelling</Label>
                <Input id={`${id}-name`} autoFocus required pattern=".*\S.*" value={name} onChange={(event) => setName(event.target.value)} placeholder="Claude" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${id}-aliases`}>Heard as</Label>
                <Textarea id={`${id}-aliases`} value={aliases} onChange={(event) => setAliases(event.target.value)} placeholder="clod, cloud AI" aria-describedby={`${id}-aliases-help`} />
                <p id={`${id}-aliases-help`} className="text-xs leading-relaxed text-muted-foreground">Separate variants with commas. Lowercase “claude” is already covered by “Claude”.</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${id}-note`}>Context <span className="font-normal text-muted-foreground">(optional)</span></Label>
                <Textarea id={`${id}-note`} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Anthropic’s AI assistant" aria-describedby={`${id}-note-help`} />
                <p id={`${id}-note-help`} className="text-xs text-muted-foreground">Tell the agents what this name refers to.</p>
              </div>
            </fieldset>
            {!isNew && <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-foreground/5 p-3">
              <div className="min-w-0 flex-1"><p className="text-sm font-medium">{selection.term.brand ? "Subject look" : "Make it a subject"}</p><p className="mt-1 text-xs text-muted-foreground">{dirty ? "Save your changes before editing the look." : "Colours, fonts and a logo for projects about it."}</p></div>
              <Button type="button" size="sm" variant="outline" disabled={dirty || pending} onClick={onLook}>{selection.term.brand ? <Swatches kit={selection.term.brand} small /> : <Palette aria-hidden />}{selection.term.brand ? "Edit look" : "Add look"}</Button>
            </div>}
          </>}
          <ErrorLine>{error}</ErrorLine>
          <DialogFooter>
            {!isNew && !removing && <Button type="button" variant="ghost" className="sm:me-auto text-muted-foreground" disabled={pending} onClick={() => setRemoving(true)}><Trash2 aria-hidden />Remove</Button>}
            <Button type="button" variant="outline" disabled={pending} onClick={() => { if (removing) setRemoving(false); else onClose(); }}>{removing ? "Keep name" : "Cancel"}</Button>
            <Button type="submit" variant={removing ? "destructive" : "default"} disabled={pending}>
              {pending && <Loader2 aria-hidden className="motion-safe:animate-spin" />}{removing ? "Remove name" : "Save name"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
