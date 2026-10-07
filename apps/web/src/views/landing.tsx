import type { JSX } from "hono/jsx/jsx-runtime";
import type { PackListing } from "../lib/packs";
import { ArrowRightIcon, BotIcon, DownloadIcon, HardDriveIcon, MonitorIcon, PackageIcon, TerminalIcon } from "./icons";
import { ClaudeMark, GitHubMark, OpenAiMark, OpencodeMark } from "./marks";
import { REPO_URL } from "./layout";
import { PackCard } from "./pack-card";
import { Command, SectionHeading, btn, card } from "./ui";

const AGENTS = [
  { name: "Claude Code", Mark: ClaudeMark, add: "claude mcp add agentcut -- agentcut mcp" },
  { name: "Codex", Mark: OpenAiMark, add: "codex mcp add agentcut -- agentcut mcp" },
  { name: "OpenCode", Mark: OpencodeMark, add: "agentcut mcp" },
];

export function Landing({ packs }: { packs: PackListing[] }) {
  return (
    <>
      <Hero />
      <HowItWorks />
      <TwoInterfaces />
      <Agents />
      <PacksTeaser packs={packs} />
      <Closing />
    </>
  );
}

function Hero() {
  return (
    <section class="relative overflow-x-clip">
      <div aria-hidden="true" class="hero-glow pointer-events-none absolute inset-x-0 -top-24 h-[44rem]" />
      <div class="relative mx-auto max-w-6xl px-6 pt-16 sm:pt-24">
        <div class="mx-auto max-w-3xl text-center">
          <p class="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 py-1 pl-1.5 pr-3.5 text-[0.8rem] font-medium text-muted-foreground">
            <span class="flex items-center -space-x-1">
              {AGENTS.map(({ Mark }) => (
                <span class="grid size-6 place-items-center rounded-full bg-secondary text-foreground ring-2 ring-background">
                  <Mark class="size-3.5" />
                </span>
              ))}
            </span>
            <span class="hidden sm:inline">Works with</span> Claude Code, Codex and OpenCode
          </p>
          <h1 class="mt-7 text-[2.6rem] font-semibold leading-[1.05] tracking-[-0.035em] text-balance sm:text-6xl md:text-7xl">
            Edit video with your coding agent
          </h1>
          <p class="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground text-pretty sm:text-xl">
            agentcut is a video editor that runs on your computer. Your agent makes the cuts, captions and
            titles; you open the studio to review and change anything. Both of you work on the same project.
          </p>
        </div>

        <div class="mx-auto mt-10 max-w-xl">
          <div class={`${card} p-2`}>
            <ol class="space-y-2">
              <li class="flex flex-col gap-2 rounded-[1.25rem] bg-white/[0.03] p-3 sm:flex-row sm:items-center sm:gap-4">
                <span class="w-28 shrink-0 pl-1 text-xs font-medium text-muted-foreground"><span class="text-primary tabular-nums">1</span>&ensp;Install</span>
                <Command text="npm i -g agentcut" class="flex-1" />
              </li>
              <li class="flex flex-col gap-2 rounded-[1.25rem] bg-white/[0.03] p-3 sm:flex-row sm:items-center sm:gap-4">
                <span class="w-28 shrink-0 pl-1 text-xs font-medium text-muted-foreground"><span class="text-primary tabular-nums">2</span>&ensp;Open the studio</span>
                <Command text="agentcut" class="flex-1" />
              </li>
            </ol>
          </div>
          <p class="mt-4 text-center text-sm text-muted-foreground text-pretty">
            Needs Node.js 22.13 or later and an agent CLI you are signed in to.
          </p>
          <div class="mt-6 flex flex-wrap items-center justify-center gap-3">
            <a href="/packs" class={btn.primary}>
              Browse packs
              <ArrowRightIcon class="size-4" strokeWidth={2} />
            </a>
            <a href={REPO_URL} class={btn.outline}>
              <GitHubMark class="size-4" />
              View on GitHub
            </a>
          </div>
        </div>

        <figure class="relative mx-auto mt-16 max-w-6xl sm:mt-20">
          <div class="rounded-[1.75rem] border border-white/10 bg-white/[0.03] p-1.5 shadow-[0_40px_120px_-30px_rgb(0_0_0/0.9)] sm:p-2">
            <img src="/editor.jpg" width="2000" height="1250" alt="The agentcut studio: assets on the left, a vertical clip in the preview, the timeline below and the agent conversation on the right."
              class="w-full rounded-[1.3rem] outline outline-1 -outline-offset-1 outline-white/10" />
          </div>
          <figcaption class="mt-4 text-center text-sm text-muted-foreground">
            The studio. The conversation on the right is the same agent you run in your terminal.
          </figcaption>
        </figure>
      </div>
    </section>
  );
}

function Step({ n, title, Icon, children }: { n: number; title: string; Icon: (p: { class?: string }) => JSX.Element; children: JSX.Element | JSX.Element[] | string }) {
  return (
    <li class={`${card} flex flex-col p-6`}>
      <div class="flex items-center justify-between">
        <span class="grid size-10 place-items-center rounded-2xl bg-white/6 text-foreground">
          <Icon class="size-5" />
        </span>
        <span class="font-mono text-xs tabular-nums text-muted-foreground">0{n}</span>
      </div>
      <h3 class="mt-6 text-lg font-semibold tracking-[-0.01em]">{title}</h3>
      <div class="mt-2 text-sm leading-relaxed text-muted-foreground text-pretty">{children}</div>
    </li>
  );
}

function HowItWorks() {
  return (
    <section id="how-it-works" class="mx-auto mt-28 max-w-6xl px-6 sm:mt-36">
      <SectionHeading eyebrow="How it works" title="A small command. The rest arrives when you need it.">
        The npm package is only the command. Everything heavy downloads the first time it is used, then
        runs offline on your machine.
      </SectionHeading>
      <ol class="mt-12 grid gap-4 md:grid-cols-3">
        <Step n={1} title="Install the CLI" Icon={TerminalIcon}>
          <p><code class="font-mono text-[0.8rem] text-foreground">npm i -g agentcut</code> puts one command on your path.</p>
        </Step>
        <Step n={2} title="Open the studio" Icon={DownloadIcon}>
          <p>
            Running <code class="font-mono text-[0.8rem] text-foreground">agentcut</code> opens the visual editor in your
            browser. The studio, the renderer and ffmpeg download on first use.
          </p>
        </Step>
        <Step n={3} title="Connect your agent" Icon={BotIcon}>
          <p>Register agentcut as an MCP server once. Your agent gets the editor's tools and edits the project you have open.</p>
        </Step>
      </ol>
    </section>
  );
}

function TwoInterfaces() {
  return (
    <section class="mx-auto mt-28 max-w-6xl px-6 sm:mt-36">
      <SectionHeading eyebrow="One editor, two interfaces" title="You and your agent edit the same project">
        The studio and the agent's tools are two ways into one editor. Both call the same operations, are
        checked by the same validation and save to the same project, so neither can do something the other cannot.
      </SectionHeading>
      <div class="mt-12 grid gap-4 md:grid-cols-2">
        <div class={`${card} p-7`}>
          <div class="flex items-center gap-3">
            <span class="grid size-10 place-items-center rounded-2xl bg-white/6"><MonitorIcon class="size-5" /></span>
            <h3 class="text-lg font-semibold tracking-[-0.01em]">You, in the studio</h3>
          </div>
          <ul class="mt-6 space-y-3 text-sm leading-relaxed text-muted-foreground">
            <li class="flex gap-3"><Dot />A timeline with overlapping video layers, titles, images and music.</li>
            <li class="flex gap-3"><Dot />Trim, reorder and restyle captions by hand, with undo.</li>
            <li class="flex gap-3"><Dot />Ask for a change in the conversation panel and watch it land.</li>
          </ul>
        </div>
        <div class={`${card} p-7`}>
          <div class="flex items-center gap-3">
            <span class="grid size-10 place-items-center rounded-2xl bg-white/6"><TerminalIcon class="size-5" /></span>
            <h3 class="text-lg font-semibold tracking-[-0.01em]">Your agent, over MCP or the CLI</h3>
          </div>
          <ul class="mt-6 space-y-3 text-sm leading-relaxed text-muted-foreground">
            <li class="flex gap-3"><Dot />Reads the transcript and the timeline, then edits with the same operations.</li>
            <li class="flex gap-3"><Dot />Finds clips in a long recording and cuts them to your templates.</li>
            <li class="flex gap-3"><Dot />Works with the studio closed. Open it later and every change is there.</li>
          </ul>
        </div>
      </div>
      <div class={`${card} mt-4 flex flex-col gap-4 p-7 sm:flex-row sm:items-center`}>
        <span class="grid size-10 shrink-0 place-items-center rounded-2xl bg-white/6"><HardDriveIcon class="size-5" /></span>
        <div>
          <h3 class="font-semibold">Your projects stay on your computer</h3>
          <p class="mt-1 text-sm leading-relaxed text-muted-foreground text-pretty">
            Media, projects and exports are stored locally, and editing and rendering need no agentcut account.
            Your agent sends prompts, transcripts and sampled frames to its own AI provider.
          </p>
        </div>
      </div>
    </section>
  );
}

function Dot() {
  return <span aria-hidden="true" class="mt-2 size-1.5 shrink-0 rounded-full bg-primary/80" />;
}

function Agents() {
  return (
    <section id="agents" class="mx-auto mt-28 max-w-6xl px-6 sm:mt-36">
      <SectionHeading eyebrow="Agents" title="Uses the agent you already have">
        agentcut drives the coding agent installed on your machine, signed in with your own account. It does
        not need an API key of its own.
      </SectionHeading>
      <ul class={`${card} mt-12 divide-y divide-white/8`}>
        {AGENTS.map(({ name, Mark, add }) => (
          <li class="flex flex-col gap-4 p-5 sm:p-6 md:flex-row md:items-center">
            <div class="flex items-center gap-3 md:w-64 md:shrink-0">
              <span class="grid size-11 place-items-center rounded-2xl bg-white/6 text-foreground">
                <Mark class="size-5" />
              </span>
              <div>
                <h3 class="font-semibold tracking-[-0.01em]">{name}</h3>
                <p class="text-xs text-muted-foreground">{name === "OpenCode" ? "MCP server command in its config" : "Register once"}</p>
              </div>
            </div>
            <Command text={add} class="min-w-0 flex-1" />
          </li>
        ))}
      </ul>
    </section>
  );
}

function PacksTeaser({ packs }: { packs: PackListing[] }) {
  return (
    <section id="packs" class="mx-auto mt-28 max-w-6xl px-6 sm:mt-36">
      <div class="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <SectionHeading eyebrow="Packs" title="Install somebody's way of editing">
          A pack carries templates, rules, a style guide and assets that belong together. Install one and your
          agent edits to it: what to cut, how the captions read, what a finished video has to be.
        </SectionHeading>
        <a href="/packs" class={`${btn.outline} self-start sm:self-auto`}>
          <PackageIcon class="size-4" />
          Browse packs
        </a>
      </div>
      {packs.length ? (
        <div class="mt-12 grid gap-4 md:grid-cols-3">
          {packs.map((p) => <PackCard pack={p} />)}
        </div>
      ) : (
        <div class={`${card} mt-12 p-8 text-sm text-muted-foreground`}>
          No packs have been published yet. <a href="/packs" class="font-medium text-foreground underline decoration-white/30 underline-offset-4 hover:decoration-foreground">Learn how to publish one</a>.
        </div>
      )}
    </section>
  );
}

function Closing() {
  return (
    <section class="mx-auto mt-28 max-w-6xl px-6 sm:mt-36">
      <div class="relative overflow-hidden rounded-4xl border border-white/10 bg-card px-6 py-14 text-center sm:px-12">
        <div aria-hidden="true" class="hero-glow pointer-events-none absolute inset-0" />
        <div class="relative">
          <h2 class="text-3xl font-semibold tracking-[-0.02em] text-balance sm:text-4xl">Start with one command</h2>
          <p class="mx-auto mt-4 max-w-lg text-muted-foreground text-pretty">
            Install it, run it, and describe the video you want to your agent.
          </p>
          <Command text="npm i -g agentcut" class="mx-auto mt-8 max-w-sm text-left" />
        </div>
      </div>
    </section>
  );
}
