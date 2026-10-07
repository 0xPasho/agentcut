import type { JSX } from "hono/jsx/jsx-runtime";
import type { Child } from "hono/jsx";
import type { PackDetail } from "../lib/packs";
import { bytes, count, isoDate, longDate, timeAgo } from "../lib/format";
import {
  BookIcon, CodeIcon, DownloadIcon, FileTextIcon, FilmIcon, ImageIcon, LayoutIcon, LinkIcon, MessageIcon, MusicIcon,
  RuleIcon, ShieldAlertIcon, TagIcon, ZapIcon,
} from "./icons";
import { CountsRow } from "./pack-card";
import { Markdown } from "./markdown";
import { Avatar, Command, CopyButton, card } from "./ui";

const ASSET_ICONS = { audio: MusicIcon, video: FilmIcon, image: ImageIcon };

export type NamedDoc = { id: string; name: string; description: string; when?: string };
export type ReviewSummary = { checks: number; rubric: number; critical: number };

type Props = {
  pack: PackDetail;
  style: string | null;
  templates: NamedDoc[];
  rules: NamedDoc[];
  review: ReviewSummary | null;
};

export function PackDetailPage({ pack, style, templates, rules, review }: Props) {
  const m = pack.manifest;
  return (
    <div class="mx-auto max-w-6xl px-6 pt-10 sm:pt-14">
      <nav aria-label="Breadcrumb" class="text-sm text-muted-foreground">
        <a href="/packs" class="hover:text-foreground">Packs</a>
        <span aria-hidden="true" class="px-2 text-white/25">/</span>
        <span class="font-mono text-foreground/80">{pack.name}</span>
      </nav>

      <header class="mt-6 max-w-3xl">
        <h1 class="text-4xl font-semibold tracking-[-0.03em] text-balance sm:text-5xl">{pack.title}</h1>
        <div class="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
          <span class="flex items-center gap-2">
            <Avatar login={pack.owner.login} url={pack.owner.avatarUrl} size="size-6" />
            <span>Published by <span class="font-medium text-foreground">{pack.owner.login}</span></span>
          </span>
          {pack.author && pack.author !== pack.owner.login ? <span>Author: {pack.author}</span> : null}
          <span class="font-mono text-xs">v{pack.latest}</span>
          <span>Updated <time datetime={isoDate(pack.updatedAt)}>{timeAgo(pack.updatedAt)}</time></span>
        </div>
        {pack.description ? <p class="mt-6 text-lg leading-relaxed text-muted-foreground text-pretty">{pack.description}</p> : null}
        <CountsRow counts={pack.counts} class="mt-6" />
      </header>

      <div class="mt-12 grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
        <div class="order-2 space-y-6 lg:order-1">
          {m.recipes.length ? <RecipeWarning pack={pack} /> : null}

          {style ? (
            <Section title="Style guide" Icon={BookIcon} note={m.style}>
              <Markdown source={style} />
            </Section>
          ) : null}

          {templates.length ? (
            <Section title="Templates" Icon={LayoutIcon}>
              <DocList docs={templates} />
            </Section>
          ) : null}

          {rules.length ? (
            <Section title="Rules" Icon={RuleIcon} note="Text your agent follows. Read it before you install.">
              <DocList docs={rules} />
            </Section>
          ) : null}

          {m.recipes.length ? (
            <Section title="Recipes" Icon={CodeIcon} note="Code. Runs only after you trust it.">
              <ul class="divide-y divide-white/8">
                {m.recipes.map((r) => (
                  <li class="py-4 first:pt-0 last:pb-0">
                    <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <p class="font-medium">{r.label}</p>
                      <code class="font-mono text-xs text-muted-foreground">{r.file}</code>
                    </div>
                    {r.description ? <p class="mt-1.5 text-sm leading-relaxed text-muted-foreground text-pretty">{r.description}</p> : null}
                    {Object.keys(r.params).length ? (
                      <p class="mt-2 text-xs text-muted-foreground">
                        Parameters: {Object.keys(r.params).map((k, i) => <>{i ? ", " : ""}<code class="font-mono text-foreground/80">{k}</code></>)}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
              {m.recipeFiles.length ? (
                <p class="mt-4 border-t border-white/8 pt-4 text-xs leading-relaxed text-muted-foreground">
                  Also carries {m.recipeFiles.map((f, i) => <>{i ? ", " : ""}<code class="font-mono text-foreground/80">{f}</code></>)}
                </p>
              ) : null}
            </Section>
          ) : null}

          {m.assets.length ? (
            <Section title="Assets" Icon={ImageIcon}>
              <ul class="divide-y divide-white/8">
                {m.assets.map((a) => {
                  const Icon = ASSET_ICONS[a.kind];
                  return (
                    <li class="flex gap-3 py-3 first:pt-0 last:pb-0">
                      <span class="mt-0.5 grid size-8 shrink-0 place-items-center rounded-xl bg-white/6 text-muted-foreground"><Icon class="size-4" /></span>
                      <div class="min-w-0">
                        <p class="font-medium">{a.name}</p>
                        <p class="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                          <span class="capitalize">{a.kind}</span>
                          {a.license ? <> · {a.license}</> : null}
                          {a.attribution ? <> · {a.attribution}</> : null}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Section>
          ) : null}

          {m.examples.length ? (
            <Section title="Reference examples" Icon={FilmIcon}>
              <ul class="space-y-3">
                {m.examples.map((e) => (
                  <li>
                    <p class="font-medium">{e.title || e.file}</p>
                    {e.note ? <p class="mt-1 text-sm text-muted-foreground text-pretty">{e.note}</p> : null}
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}

          {m.quickActions.length ? (
            <Section title="Quick actions" Icon={ZapIcon} note="Buttons it adds beside the agent conversation.">
              <ul class="space-y-3">
                {m.quickActions.map((q) => (
                  <li class="rounded-2xl bg-white/[0.03] p-4">
                    <p class="font-medium">{q.label}</p>
                    <p class="mt-1 text-sm leading-relaxed text-muted-foreground text-pretty">{q.text}</p>
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}

          {m.glossary.length ? (
            <Section title="Glossary" Icon={TagIcon}>
              <ul class="flex flex-wrap gap-2">
                {m.glossary.map((g) => (
                  <li class="rounded-full bg-white/6 px-3 py-1 text-sm">{g.term}</li>
                ))}
              </ul>
            </Section>
          ) : null}

          {review ? (
            <Section title="What correct looks like" Icon={FileTextIcon} note={m.review}>
              <p class="text-sm leading-relaxed text-muted-foreground text-pretty">
                {review.checks === 1 ? "1 measured check" : `${review.checks} measured checks`} and{" "}
                {review.rubric === 1 ? "1 question" : `${review.rubric} questions`} the agent answers with evidence
                {review.critical ? `; ${review.critical} of them critical, which hold an export until fixed or waived` : ""}.
              </p>
            </Section>
          ) : null}
        </div>

        <aside class="order-1 min-w-0 space-y-4 lg:sticky lg:top-24 lg:order-2">
          <div class={`${card} p-5`}>
            <h2 class="text-sm font-semibold">Install</h2>
            <Command text={`agentcut packs install ${pack.name}`} class="mt-3" small />
            <p class="mt-5 text-xs leading-relaxed text-muted-foreground">Or paste this URL in <span class="text-foreground">Settings → Packs</span> in the studio:</p>
            <div class="mt-2 flex min-w-0 items-center gap-2 rounded-2xl border border-white/10 bg-black/40 py-1 pl-3 pr-1">
              <LinkIcon class="size-3.5 shrink-0 text-muted-foreground" />
              <code class="min-w-0 flex-1 truncate font-mono text-xs text-foreground/90" title={pack.source}>{pack.source}</code>
              <CopyButton text={pack.source} label="Copy pack URL" />
            </div>
            <dl class="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-white/8 pt-5 text-sm">
              <dt class="text-muted-foreground">Installs</dt>
              <dd class="flex items-center justify-end gap-1.5 tabular-nums"><DownloadIcon class="size-3.5 text-muted-foreground" />{count(pack.downloads)}</dd>
              <dt class="text-muted-foreground">Latest</dt>
              <dd class="text-right font-mono text-xs leading-5">{pack.latest}</dd>
              <dt class="text-muted-foreground">Size</dt>
              <dd class="text-right tabular-nums">{bytes(pack.versions.find((v) => v.version === pack.latest)?.size ?? 0)}</dd>
              <dt class="text-muted-foreground">Id</dt>
              <dd class="truncate text-right font-mono text-xs leading-5">{pack.name}</dd>
            </dl>
          </div>

          <div class={`${card} p-5`}>
            <h2 class="text-sm font-semibold">Versions</h2>
            <ol class="mt-3 space-y-1">
              {pack.versions.map((v) => (
                <li class="flex items-center gap-3 rounded-xl px-2 py-1.5 text-sm odd:bg-white/[0.02]">
                  <span class="font-mono text-xs">{v.version}</span>
                  {v.version === pack.latest ? <span class="rounded-full bg-primary/15 px-2 py-0.5 text-[0.7rem] font-medium text-primary">latest</span> : null}
                  <time datetime={isoDate(v.publishedAt)} class="ml-auto text-xs text-muted-foreground">{longDate(v.publishedAt)}</time>
                </li>
              ))}
            </ol>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Section({ title, Icon, note, children }: { title: string; Icon: (p: { class?: string }) => JSX.Element; note?: string; children: Child }) {
  return (
    <section class={`${card} p-6 sm:p-7`}>
      <div class="mb-5 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span class="grid size-8 place-items-center rounded-xl bg-white/6 text-muted-foreground"><Icon class="size-4" /></span>
        <h2 class="text-lg font-semibold tracking-[-0.01em]">{title}</h2>
        {note ? <span class="text-xs text-muted-foreground sm:ml-auto">{note}</span> : null}
      </div>
      {children}
    </section>
  );
}

function DocList({ docs }: { docs: NamedDoc[] }) {
  return (
    <ul class="divide-y divide-white/8">
      {docs.map((d) => (
        <li class="py-4 first:pt-0 last:pb-0">
          <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <p class="font-medium text-pretty">{d.name}</p>
            <code class="font-mono text-xs text-muted-foreground">{d.id}</code>
          </div>
          {d.when ? (
            <p class="mt-1.5 flex gap-2 text-sm text-foreground/85">
              <MessageIcon class="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
              <span><span class="text-muted-foreground">When </span>{d.when}</span>
            </p>
          ) : null}
          {d.description ? <p class="mt-1.5 text-sm leading-relaxed text-muted-foreground text-pretty">{d.description}</p> : null}
        </li>
      ))}
    </ul>
  );
}

function RecipeWarning({ pack }: { pack: PackDetail }) {
  const n = pack.manifest.recipes.length;
  return (
    <div role="note" class="rounded-3xl border border-accent/40 bg-accent/10 p-6">
      <div class="flex gap-4">
        <span class="grid size-10 shrink-0 place-items-center rounded-2xl bg-accent/15 text-accent"><ShieldAlertIcon class="size-5" /></span>
        <div>
          <h2 class="font-semibold">This pack carries code</h2>
          <p class="mt-1.5 text-sm leading-relaxed text-foreground/80 text-pretty">
            {n === 1 ? "1 recipe" : `${n} recipes`}: JavaScript that edits your project. Installing the pack runs none of it.
            A recipe runs only after you read every file and trust it on the pack's page in Settings → Packs, or
            with <code class="font-mono text-[0.8rem] text-foreground">agentcut packs trust {pack.name}</code>. Trust covers this exact
            code: a new version that changes one byte asks again. Recipes run sandboxed, with no network.
          </p>
        </div>
      </div>
    </div>
  );
}
