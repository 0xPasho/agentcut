"use client";
import { PacksPanel } from "@/components/packs-panel";
import { SectionHeader } from "./section-header";

/**
 * Packs, moved here from the bottom of the library and otherwise untouched. A pack
 * is workspace configuration that happens to travel — templates, rules, glossary
 * entries, quick actions and the assets they name — so it belongs beside the rules
 * it installs rather than under the media it is not.
 *
 * Import is still a path or a URL you type, and export still writes a folder. There
 * is no catalogue to browse and nothing here goes looking for packs on the network.
 */
export function PacksSettings() {
  return (
    <section className="flex flex-col gap-5">
      <SectionHeader title="Packs">
        Templates, rules, glossary entries, quick actions and assets that belong together. Import one
        from a folder or a URL — you see everything it carries before anything is installed — or export
        yours to send.
      </SectionHeader>
      <div className="rounded-2xl bg-card px-4 py-4 ring-1 ring-foreground/10">
        <PacksPanel />
      </div>
    </section>
  );
}
