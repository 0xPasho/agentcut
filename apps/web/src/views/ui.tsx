import type { Child } from "hono/jsx";
import { CheckIcon, CopyIcon } from "./icons";

/** Class recipes from the studio's shadcn primitives (button.tsx, card.tsx), as plain strings. */
const buttonBase =
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-full border border-transparent text-sm font-medium whitespace-nowrap transition-[background-color,border-color,box-shadow,scale] duration-150 ease-out outline-none focus-visible:ring-3 focus-visible:ring-ring/50 motion-safe:active:scale-[0.96] disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none";

export const btn = {
  primary: `${buttonBase} h-10 px-5 border-primary/40 bg-primary/85 bg-linear-to-b from-white/20 to-transparent text-primary-foreground font-semibold shadow-[var(--control-highlight),0_3px_16px_-6px_var(--color-primary)] hover:bg-primary/95`,
  outline: `${buttonBase} h-10 px-5 border-white/15 bg-white/5 shadow-(--control-highlight) hover:border-white/25 hover:bg-white/10`,
  ghost: `${buttonBase} h-9 px-3.5 text-muted-foreground hover:bg-white/10 hover:text-foreground`,
  destructive: `${buttonBase} h-9 px-4 bg-destructive/15 text-destructive hover:bg-destructive/25`,
  smallOutline: `${buttonBase} h-8 px-3 text-[0.8rem] border-white/15 bg-white/5 shadow-(--control-highlight) hover:border-white/25 hover:bg-white/10`,
};

/** A solid content surface: cards stay solid, glass is for the navigation layer. */
export const card = "rounded-3xl border border-border bg-card shadow-(--surface-shadow)";

export function CopyButton({ text, label = "Copy command" }: { text: string; label?: string }) {
  return (
    <button type="button" data-copy={text} aria-label={label} title={label}
      class="group relative grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground transition-[background-color,color] duration-150 hover:bg-white/10 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 outline-none">
      <span class="col-start-1 row-start-1 transition-[opacity,scale,filter] duration-200 ease-[cubic-bezier(0.2,0,0,1)] group-data-copied:scale-25 group-data-copied:opacity-0 group-data-copied:blur-[4px]">
        <CopyIcon class="size-4" />
      </span>
      <span class="col-start-1 row-start-1 scale-25 opacity-0 blur-[4px] text-success transition-[opacity,scale,filter] duration-200 ease-[cubic-bezier(0.2,0,0,1)] group-data-copied:scale-100 group-data-copied:opacity-100 group-data-copied:blur-none">
        <CheckIcon class="size-4" strokeWidth={2.25} />
      </span>
      <span class="sr-only" data-copy-status aria-live="polite"></span>
    </button>
  );
}

/** One shell command on a line, with the prompt drawn and a copy button. */
export function Command({ text, class: className = "", small = false }: { text: string; class?: string; small?: boolean }) {
  return (
    <div class={`flex min-w-0 items-center gap-3 rounded-full border border-white/10 bg-black/40 py-1 pl-4 pr-1 shadow-[inset_0_1px_3px_rgb(0_0_0/0.35)] ${className}`}>
      <span aria-hidden="true" class="select-none font-mono text-sm text-primary/80">$</span>
      <code class={`min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-foreground [scrollbar-width:none] ${small ? "text-[0.78rem]" : "text-[0.85rem]"}`}>{text}</code>
      <CopyButton text={text} />
    </div>
  );
}

export function Avatar({ login, url, size = "size-6" }: { login: string; url: string | null; size?: string }) {
  if (url) {
    return <img src={url} alt="" loading="lazy" class={`${size} shrink-0 rounded-full bg-secondary outline outline-1 -outline-offset-1 outline-white/10`} />;
  }
  return (
    <span aria-hidden="true" class={`${size} grid shrink-0 place-items-center rounded-full bg-secondary ${size === "size-16" ? "text-2xl" : "text-[0.65rem]"} font-semibold uppercase text-muted-foreground outline outline-1 -outline-offset-1 outline-white/10`}>
      {login.slice(0, 1)}
    </span>
  );
}

export function SectionHeading({ eyebrow, title, children }: { eyebrow?: string; title: string; children?: Child }) {
  return (
    <div class="max-w-2xl">
      {eyebrow ? <p class="mb-3 text-sm font-medium text-primary">{eyebrow}</p> : null}
      <h2 class="text-3xl font-semibold tracking-[-0.02em] text-balance sm:text-4xl">{title}</h2>
      {children ? <p class="mt-4 text-base leading-relaxed text-muted-foreground text-pretty sm:text-lg">{children}</p> : null}
    </div>
  );
}
