import type { PackListing } from "../lib/packs";
import { PackageIcon, SearchIcon, XIcon } from "./icons";
import { PackCard } from "./pack-card";
import { Command, card } from "./ui";

export function PacksPage({ packs, q }: { packs: PackListing[]; q: string }) {
  return (
    <div class="mx-auto max-w-6xl px-6 pt-14 sm:pt-20">
      <div class="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
        <div class="max-w-2xl">
          <h1 class="text-4xl font-semibold tracking-[-0.03em] text-balance sm:text-5xl">Packs</h1>
          <p class="mt-4 text-lg leading-relaxed text-muted-foreground text-pretty">
            Templates, rules, style guides and assets that belong together, published by the people who edit with them.
            Install one from the terminal or paste its URL in <span class="text-foreground">Settings → Packs</span>.
          </p>
        </div>
        <form method="get" action="/packs" role="search" class="w-full lg:max-w-sm">
          <label for="q" class="sr-only">Search packs</label>
          <div class="flex h-11 items-center gap-2 rounded-full border border-input bg-white/[0.04] pl-4 pr-1.5 shadow-[inset_0_1px_3px_rgb(0_0_0/0.25)] focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/30">
            <SearchIcon class="size-4 shrink-0 text-muted-foreground" />
            <input id="q" name="q" type="search" value={q} placeholder="Search by name or description" autocomplete="off"
              class="h-full min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground/80 sm:text-sm [&::-webkit-search-cancel-button]:hidden" />
            {q ? (
              <a href="/packs" aria-label="Clear search" class="grid size-8 place-items-center rounded-full text-muted-foreground hover:bg-white/10 hover:text-foreground">
                <XIcon class="size-4" />
              </a>
            ) : null}
          </div>
        </form>
      </div>

      {q ? (
        <p class="mt-10 text-sm text-muted-foreground" aria-live="polite">
          {packs.length === 1 ? "1 pack" : `${packs.length} packs`} matching <span class="font-medium text-foreground">“{q}”</span>
        </p>
      ) : null}

      {packs.length ? (
        <div class={`${q ? "mt-4" : "mt-12"} grid gap-4 sm:grid-cols-2 lg:grid-cols-3`}>
          {packs.map((p) => <PackCard pack={p} />)}
        </div>
      ) : q ? (
        <div class={`${card} mt-4 flex flex-col items-start gap-3 p-8`}>
          <p class="font-medium">No packs match “{q}”</p>
          <p class="text-sm text-muted-foreground">Search looks at the pack's id, name and description.</p>
          <a href="/packs" class="mt-1 text-sm font-medium text-primary hover:underline underline-offset-4">Show all packs</a>
        </div>
      ) : (
        <EmptyState />
      )}

      {packs.length ? <PublishHint /> : null}
    </div>
  );
}

function EmptyState() {
  return (
    <div class={`${card} mt-12 flex flex-col items-center px-6 py-14 text-center`}>
      <span class="grid size-12 place-items-center rounded-2xl bg-white/6"><PackageIcon class="size-6" /></span>
      <h2 class="mt-5 text-xl font-semibold">No packs yet</h2>
      <p class="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground text-pretty">
        A pack is a folder with a <code class="font-mono text-foreground">pack.json</code>. Sign in from the terminal
        and publish yours; it shows up here as soon as it is accepted.
      </p>
      <div class="mt-8 w-full max-w-md space-y-2 text-left">
        <Command text="agentcut login" />
        <Command text="agentcut packs publish ./my-pack" />
      </div>
    </div>
  );
}

function PublishHint() {
  return (
    <section class={`${card} mt-16 grid gap-6 p-7 md:grid-cols-[1fr_minmax(0,26rem)] md:items-center`}>
      <div>
        <h2 class="text-lg font-semibold">Publish your own</h2>
        <p class="mt-2 text-sm leading-relaxed text-muted-foreground text-pretty">
          Export a pack from <span class="text-foreground">Settings → Packs</span> in the studio, or write the folder by hand,
          then publish it from the terminal. The first person to publish a name owns it.
        </p>
      </div>
      <div class="space-y-2">
        <Command text="agentcut login" />
        <Command text="agentcut packs publish ./my-pack" />
      </div>
    </section>
  );
}
