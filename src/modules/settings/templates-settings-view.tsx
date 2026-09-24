"use client";
import { useState } from "react";
import Link from "next/link";
import { Loader2, Package, Trash2 } from "lucide-react";
import { api } from "@/common/api/client";
import { Badge } from "@/common/ui/badge";
import { Button } from "@/common/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/common/ui/tabs";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/common/ui/dialog";
import { Empty, ErrorLine, Loading, SectionHeader } from "./components/section-header";
import { useWorkspaceSettings } from "./hooks";
import type { TemplateOption } from "./types";
import { makesLine } from "./lib";
import { aspectOf } from "@/modules/templates/lib/resolve";

/**
 * Every template on this machine and where it came from (decision 134): built in,
 * saved by you from the editor, or brought by a pack. Editing stays in the editor,
 * where a template is previewed against a real video; here a template is seen,
 * traced and, if it is yours, deleted — the `templates.delete` tool, which had no
 * button anywhere.
 */
export function TemplatesSettings() {
  const { data, error, pending, run } = useWorkspaceSettings();
  const [show, setShow] = useState<"all" | "yours" | "builtin">("all");

  const all = data?.templates ?? [];
  const yours = all.filter((t) => !t.builtin);
  const shown = all.filter((t) => show === "all" || (show === "yours" ? !t.builtin : t.builtin));
  const packName = (id: string | null) => (id ? (data?.packs.find((p) => p.id === id)?.name ?? id) : null);
  const usedBy = (id: string) => (data?.rules ?? []).filter((r) => r.then.template === id).map((r) => r.name);

  return (
    <section className="flex flex-col gap-5">
      <SectionHeader title="Templates">
        The layouts a video can be made in. A template is chosen in the editor, or by a rule, and
        saved from there as a variation of your own; a pack brings its own.
      </SectionHeader>

      {!data && <Loading label="Loading your templates" />}
      {data && (
        <>
          <Tabs value={show} onValueChange={(v) => setShow(v as typeof show)}>
            <TabsList aria-label="Which templates to show">
              <TabsTrigger value="all">All <span className="ms-1 tabular-nums text-muted-foreground">{all.length}</span></TabsTrigger>
              <TabsTrigger value="yours">Yours <span className="ms-1 tabular-nums text-muted-foreground">{yours.length}</span></TabsTrigger>
              <TabsTrigger value="builtin">Built in <span className="ms-1 tabular-nums text-muted-foreground">{all.length - yours.length}</span></TabsTrigger>
            </TabsList>
          </Tabs>
          {shown.length === 0 && (
            <Empty title="No templates of your own yet">
              Open a video, change a template&apos;s settings and choose <em>Save as a template</em> in the editor. It appears here, and packs can carry it.
            </Empty>
          )}
          {shown.length > 0 && (
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {shown.map((template) => (
                <TemplateCard
                  key={template.id} template={template} packName={packName(template.pack)} usedBy={usedBy(template.id)}
                  pending={pending === `delete:${template.id}`}
                  onDelete={() => run(`delete:${template.id}`, () => api.workspace({ action: "templates.delete", id: template.id }))}
                />
              ))}
            </ul>
          )}
        </>
      )}
      <ErrorLine>{error}</ErrorLine>
    </section>
  );
}

function TemplateCard({ template, packName, usedBy, pending, onDelete }: { template: TemplateOption; packName: string | null; usedBy: string[]; pending: boolean; onDelete: () => void }) {
  const aspect = template.output ? aspectOf(template.output) : "9:16";
  const tall = template.output ? template.output.height >= template.output.width : true;
  return (
    <li className="flex flex-col gap-3 rounded-2xl bg-card p-3 ring-1 ring-foreground/10">
      {/* The schematic is drawn on a near-black ground, so it sits on a lighter well with its own edge. */}
      <div className={`flex items-center justify-center overflow-hidden rounded-xl bg-foreground/[0.06] ${tall ? "h-44" : "h-32"}`}>
        {/* eslint-disable-next-line @next/next/no-img-element -- a schematic the app draws, not an optimisable remote image */}
        <img src={`/api/templates/${encodeURIComponent(template.id)}/preview?aspect=${encodeURIComponent(aspect)}`} alt={`${template.name} layout`} className="h-[88%] w-auto rounded-md outline-1 -outline-offset-1 outline-white/10" />
      </div>
      <div className="flex min-w-0 flex-col gap-1 px-1">
        <p className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{template.name}</span>
          {template.builtin && <Badge variant="secondary" className="text-[10px]">Built in</Badge>}
          {!template.builtin && packName && <Badge variant="outline" className="gap-1 text-[10px] font-normal"><Package aria-hidden className="size-3" />{packName}</Badge>}
          {!template.builtin && !packName && <Badge variant="outline" className="text-[10px] font-normal">Yours</Badge>}
        </p>
        {template.description && <p className="text-xs text-muted-foreground">{template.description}</p>}
        <p className="text-xs text-muted-foreground">
          {[makesLine(template.makes), template.output ? `${template.output.width}×${template.output.height}` : "", template.extends ? `builds on ${template.extends}` : ""].filter(Boolean).join(" · ")}
        </p>
        {!!usedBy.length && <p className="text-xs text-muted-foreground">Chosen by {usedBy.length === 1 ? "the rule" : "rules"} <Link href="/settings/rules" className="underline underline-offset-2">{usedBy.join(", ")}</Link>.</p>}
      </div>
      {!template.builtin && (
        <div className="mt-auto flex items-center justify-end px-1">
          <DeleteTemplate template={template} usedBy={usedBy} pending={pending} onDelete={onDelete} />
        </div>
      )}
    </li>
  );
}

function DeleteTemplate({ template, usedBy, pending, onDelete }: { template: TemplateOption; usedBy: string[]; pending: boolean; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="xs" variant="ghost" aria-label={`Delete ${template.name}`} />}>
        <Trash2 aria-hidden />Delete
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete this template?</DialogTitle>
          <DialogDescription className="break-words">
            “{template.name}” goes from this machine. Videos already made with it keep their look.
            {usedBy.length ? ` The rule${usedBy.length === 1 ? "" : "s"} ${usedBy.join(", ")} still name${usedBy.length === 1 ? "s" : ""} it and will ask for a template that is not there.` : ""}
            {template.pack ? " The pack it came from stays installed; importing it again brings the template back." : ""}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button variant="destructive" disabled={pending} onClick={() => { onDelete(); setOpen(false); }}>
            {pending && <Loader2 aria-hidden className="motion-safe:animate-spin" />}Delete template
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
