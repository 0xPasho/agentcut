import type { PackCounts, PackListing } from "../lib/packs";
import { count, isoDate, plural, timeAgo } from "../lib/format";
import { CodeIcon, DownloadIcon, ImageIcon, LayoutIcon, RuleIcon } from "./icons";
import { Avatar, card } from "./ui";

export function CountsRow({ counts, class: className = "" }: { counts: PackCounts; class?: string }) {
  const items = [
    { n: counts.templates, one: "template", many: "templates", Icon: LayoutIcon },
    { n: counts.rules, one: "rule", many: "rules", Icon: RuleIcon },
    { n: counts.assets, one: "asset", many: "assets", Icon: ImageIcon },
    { n: counts.recipes, one: "recipe", many: "recipes", Icon: CodeIcon },
  ].filter((i) => i.n > 0);
  if (!items.length) return null;
  return (
    <ul class={`flex flex-wrap gap-1.5 ${className}`} aria-label="Contents">
      {items.map(({ n, one, many, Icon }) => (
        <li class="inline-flex items-center gap-1.5 rounded-full bg-white/6 px-2.5 py-1 text-xs font-medium text-foreground/85">
          <Icon class="size-3.5 text-muted-foreground" />
          {plural(n, one, many)}
        </li>
      ))}
    </ul>
  );
}

export function PackCard({ pack }: { pack: PackListing }) {
  return (
    <article class={`${card} group relative flex flex-col p-6 transition-[border-color,background-color] duration-150 hover:border-white/20 hover:bg-[oklch(0.22_0_0)]`}>
      <div class="flex items-start justify-between gap-4">
        <div class="min-w-0">
          <h3 class="text-lg font-semibold leading-snug tracking-[-0.01em] text-balance">
            <a href={`/packs/${pack.name}`} class="outline-none after:absolute after:inset-0 after:rounded-3xl focus-visible:after:ring-3 focus-visible:after:ring-ring/50">
              {pack.title}
            </a>
          </h3>
          <p class="mt-1 truncate font-mono text-xs text-muted-foreground">{pack.name}</p>
        </div>
        <span class="shrink-0 rounded-full border border-white/10 px-2.5 py-0.5 font-mono text-xs tabular-nums text-muted-foreground">v{pack.latest}</span>
      </div>
      <p class="mt-4 line-clamp-3 text-sm leading-relaxed text-muted-foreground text-pretty">{pack.description || "No description."}</p>
      <CountsRow counts={pack.counts} class="mt-5" />
      <div aria-hidden="true" class="flex-1" />
      <div class="mt-5 flex items-center gap-3 border-t border-white/8 pt-4 text-xs text-muted-foreground">
        <span class="flex min-w-0 items-center gap-2">
          <Avatar login={pack.owner.login} url={pack.owner.avatarUrl} size="size-5" />
          <span class="truncate font-medium text-foreground/85">{pack.owner.login}</span>
        </span>
        <span class="ml-auto inline-flex items-center gap-1.5 tabular-nums" title={`${pack.downloads} installs`}>
          <DownloadIcon class="size-3.5" />
          {count(pack.downloads)}
        </span>
        <time datetime={isoDate(pack.updatedAt)} class="whitespace-nowrap">{timeAgo(pack.updatedAt)}</time>
      </div>
    </article>
  );
}
