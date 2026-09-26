"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, BookA, FolderOpen, Globe, Images, LayoutTemplate, Loader2, MessageSquareText, Scale, Trash2 } from "lucide-react";
import { api } from "@/common/api/client";
import type { InstalledPack } from "@/modules/packs/types";
import { StyleEditor } from "@/modules/packs/components/style-editor";
import { RecipesTrust } from "@/modules/packs/components/recipes-trust";
import { ReviewEditor } from "@/modules/review/components/review-editor";
import { Button } from "@/common/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/common/ui/dialog";
import { Empty, ErrorLine, Loading, Panel, PanelHeading, SectionHeader } from "./components/section-header";
import { useWorkspaceSettings } from "./hooks";
import { count, packOrigin } from "./lib";
import type { WorkspaceSettings } from "./types";

/**
 * One pack (decision 133): what it brought and where each thing landed, where it
 * came from, its style guide with its references, and the standard it holds videos
 * to. Every editor here is the one an agent's `packs.style.*`, `packs.examples.*`
 * and `packs.review.*` tools run.
 */
export function PackView({ id }: { id: string }) {
  const { data, error, pending, run } = useWorkspaceSettings();
  const router = useRouter();
  const back = <Button size="xs" variant="ghost" className="-ms-2" nativeButton={false} render={<Link href="/settings/packs" />}><ArrowLeft />Packs</Button>;

  if (!data) return (
    <section className="flex flex-col gap-5">
      <SectionHeader title="Pack" eyebrow={back} />
      <Loading label="Loading the pack" />
    </section>
  );

  const pack = data.packs.find((p) => p.id === id);
  if (!pack) return (
    <section className="flex flex-col gap-5">
      <SectionHeader title="No such pack" eyebrow={back} />
      <Empty title={`Nothing installed is called “${id}”`} action={<Button size="sm" variant="outline" nativeButton={false} render={<Link href="/settings/packs" />}>Back to packs</Button>}>
        It may have been removed. The list has what is here now.
      </Empty>
    </section>
  );

  const origin = packOrigin(pack.source);
  const Origin = origin.kind === "url" ? Globe : FolderOpen;
  const installed = new Date(pack.installedAt);

  return (
    <section className="flex flex-col gap-5">
      <SectionHeader
        title={pack.name}
        eyebrow={back}
        action={<RemovePack pack={pack} pending={pending === `remove:${pack.id}`} onRemove={() => run(`remove:${pack.id}`, async () => { await api.workspace({ action: "packs.remove", id: pack.id }); router.push("/settings/packs"); })} />}
      >
        {pack.description || "A pack with no description."}
      </SectionHeader>

      <Panel className="flex flex-col gap-3">
        <PanelHeading title="Where it came from">
          Version {pack.version}{pack.author ? `, by ${pack.author}` : ""}. Installed {installed.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}.
          Updates are manual: import it again from the same place.
        </PanelHeading>
        <p className="flex items-center gap-1.5 break-all font-mono text-xs text-muted-foreground" title={pack.source}>
          <Origin aria-hidden className="size-3.5 shrink-0" />{pack.source}
        </p>
      </Panel>

      <Contents pack={pack} data={data} />

      {!!pack.recipes.length && (
        <Panel className="flex flex-col gap-3">
          <PanelHeading title="Recipes">
            Code this pack carries to build parts of a video — edit-time only, never at render. What it makes is ordinary editing you can change afterwards. Run them from the editor under Video → Pack recipes, or ask the agent.
          </PanelHeading>
          <RecipesTrust pack={pack} pending={pending === `trust:${pack.id}`} onTrust={(trust) => void run(`trust:${pack.id}`, () => api.workspace({ action: "packs.recipes.trust", id: pack.id, trust }))} />
        </Panel>
      )}

      <Panel className="flex flex-col gap-3">
        <PanelHeading title="Style guide and references">
          Who these videos are for, what a good one is, and the videos that show it. The agents read this before the owner&apos;s preferences, which win.
        </PanelHeading>
        <StyleEditor packId={pack.id} />
      </Panel>

      <Panel className="flex flex-col gap-3">
        <PanelHeading title="What correct looks like">
          Measured checks with thresholds this machine can take, and judged questions with evidence. The review gate in the editor holds a video to these.
        </PanelHeading>
        <ReviewEditor packId={pack.id} />
      </Panel>

      <ErrorLine>{error}</ErrorLine>
    </section>
  );
}

/**
 * What the pack brought and where each thing now lives. Nothing here stays linked
 * to the pack: a template is the workspace's template, a name is the glossary's.
 * The links go to where the thing is edited.
 */
function Contents({ pack, data }: { pack: InstalledPack; data: WorkspaceSettings }) {
  const templates = pack.provides.templates.map((id) => ({ id, name: data.templates.find((t) => t.id === id)?.name ?? id, here: data.templates.some((t) => t.id === id) }));
  const rules = pack.provides.rules.map((id) => ({ id, name: data.rules.find((r) => r.id === id)?.name ?? id, here: data.rules.some((r) => r.id === id) }));
  const assets = Object.values(pack.assets).map((id) => ({ id, name: data.assets.find((a) => a.id === id)?.name ?? id, here: data.assets.some((a) => a.id === id) }));
  const names = pack.glossary.map((term) => ({ id: term, name: term, here: data.glossary.terms.some((t) => t.term.toLowerCase() === term.toLowerCase()) }));

  const groups = [
    { key: "templates", label: "Templates", icon: LayoutTemplate, href: "/settings/templates", items: templates, gone: "deleted since" },
    { key: "rules", label: "Rules", icon: Scale, href: "/settings/rules", items: rules, gone: "deleted since" },
    { key: "names", label: "Glossary", icon: BookA, href: "/settings/glossary", items: names, gone: "removed since" },
    { key: "assets", label: "Assets", icon: Images, href: "/library", items: assets, gone: "deleted since" },
  ].filter((g) => g.items.length);

  return (
    <Panel className="flex flex-col gap-4">
      <PanelHeading title="What it brought">
        Copied into this workspace when it was installed. Each is edited where it lives now; deleting the pack takes its templates and rules and leaves the assets and names.
      </PanelHeading>
      {groups.length ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {groups.map((group) => {
            const Icon = group.icon;
            return (
              <div key={group.key} className="flex flex-col gap-1.5">
                <Link href={group.href} className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
                  <Icon aria-hidden className="size-3.5" />{group.label} <span className="tabular-nums">{group.items.length}</span>
                </Link>
                {/* Capsules are for things you can click: each one opens where the thing is edited. */}
                <ul className="flex flex-wrap gap-1.5">
                  {group.items.map((item) => (
                    <li key={item.id}>
                      <Link href={group.href} title={item.id} className={`inline-block rounded-full px-2.5 py-1 text-xs ring-1 transition-colors hover:bg-foreground/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none ${item.here ? "bg-foreground/5 ring-foreground/10" : "text-muted-foreground line-through ring-foreground/5"}`}>
                        {item.name}{!item.here && <span className="no-underline"> ({group.gone})</span>}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Nothing but its guide.</p>
      )}
      {!!pack.quickActions.length && (
        <div className="flex flex-col gap-1.5">
          <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><MessageSquareText aria-hidden className="size-3.5" />Quick actions <span className="tabular-nums">{pack.quickActions.length}</span></p>
          <ul className="flex flex-col gap-1">
            {pack.quickActions.map((a) => (
              <li key={a.label} className="rounded-xl bg-foreground/[0.04] px-3 py-2 text-xs"><span className="font-medium">{a.label}</span> <span className="text-muted-foreground">— {a.text}</span></li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">Offered beside the chat in every project. They are the pack&apos;s; edit them in its folder and import it again.</p>
        </div>
      )}
    </Panel>
  );
}

function RemovePack({ pack, pending, onRemove }: { pack: InstalledPack; pending: boolean; onRemove: () => void }) {
  const [open, setOpen] = useState(false);
  const takes = [pack.templates.length && count(pack.templates.length, "template"), pack.rules.length && count(pack.rules.length, "rule")].filter(Boolean).join(" and ");
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="ghost" />}>
        <Trash2 aria-hidden />Delete pack
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {pack.name}?</DialogTitle>
          <DialogDescription>
            {takes ? `The ${takes} it installed go with it, along with its style guide and references. ` : "Its style guide and references go with it. "}
            Its assets stay in the library and its names stay in the glossary. Videos already made with it do not change.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button variant="destructive" disabled={pending} onClick={() => { onRemove(); setOpen(false); }}>
            {pending && <Loader2 aria-hidden className="motion-safe:animate-spin" />}Delete pack
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
