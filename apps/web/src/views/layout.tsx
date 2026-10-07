import type { Child } from "hono/jsx";
import { raw } from "hono/html";
import type { User } from "../env";
import { GitHubMark } from "./marks";
import { Avatar, btn } from "./ui";

export const REPO_URL = "https://github.com/0xPasho/agentcut";

type LayoutProps = {
  title: string;
  description?: string;
  user: User | null;
  path: string;
  children: Child;
  canonical?: string;
};

/** Copy buttons: the only script on the site. */
const COPY_SCRIPT = `
document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-copy]");
  if (!b) return;
  const text = b.getAttribute("data-copy");
  try { await navigator.clipboard.writeText(text); }
  catch {
    const t = document.createElement("textarea"); t.value = text; t.setAttribute("readonly", "");
    t.style.position = "fixed"; t.style.opacity = "0"; document.body.appendChild(t); t.select();
    document.execCommand("copy"); t.remove();
  }
  b.setAttribute("data-copied", "");
  const s = b.querySelector("[data-copy-status]"); if (s) s.textContent = "Copied";
  clearTimeout(b._t);
  b._t = setTimeout(() => { b.removeAttribute("data-copied"); if (s) s.textContent = ""; }, 1600);
});`;

export function Layout({ title, description, user, path, children, canonical }: LayoutProps) {
  const fullTitle = title === "agentcut" ? "agentcut — edit video with your coding agent" : `${title} · agentcut`;
  const desc = description ?? "A local video editor your coding agent drives. Claude Code, Codex and OpenCode edit through the same operations you use in the studio.";
  return (
    <html lang="en" class="dark">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <title>{fullTitle}</title>
        <meta name="description" content={desc} />
        <meta name="theme-color" content="#101010" />
        <meta property="og:title" content={fullTitle} />
        <meta property="og:description" content={desc} />
        <meta property="og:type" content="website" />
        <meta property="og:image" content="/editor.jpg" />
        <meta name="twitter:card" content="summary_large_image" />
        {canonical ? <link rel="canonical" href={canonical} /> : null}
        <link rel="icon" href="/icon.svg" type="image/svg+xml" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <link rel="preload" href="/fonts/figtree-latin.woff2" as="font" type="font/woff2" crossorigin="" />
        <link rel="stylesheet" href="/styles.css" />
      </head>
      <body class="min-h-dvh bg-background">
        <a href="#main" class="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground">Skip to content</a>
        <div class="flex min-h-dvh flex-col">
          <Header user={user} path={path} />
          <main id="main" class="flex-1">{children}</main>
          <Footer />
        </div>
        <script>{raw(COPY_SCRIPT)}</script>
      </body>
    </html>
  );
}

function NavLink({ href, active, children }: { href: string; active: boolean; children: Child }) {
  return (
    <a href={href} aria-current={active ? "page" : undefined}
      class={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-[background-color,color] duration-150 hover:bg-white/10 hover:text-foreground ${active ? "bg-white/10 text-foreground" : "text-muted-foreground"}`}>
      {children}
    </a>
  );
}

function Header({ user, path }: { user: User | null; path: string }) {
  return (
    <header class="sticky top-0 z-40 px-3 pt-3 sm:px-6">
      <nav aria-label="Main" class="glass-surface mx-auto flex h-14 max-w-6xl items-center gap-2 rounded-full border border-transparent pl-3 pr-2 shadow-(--glass-shadow) backdrop-blur-[28px] backdrop-saturate-[1.6] reduce-transparency:glass-flat reduce-transparency:bg-popover">
        <a href="/" class="flex items-center gap-2.5 rounded-full pr-2 outline-none focus-visible:ring-3 focus-visible:ring-ring/50" aria-label="agentcut home">
          <img src="/icon.svg" alt="" width="28" height="28" class="size-7" />
          <span class="text-xl font-bold tracking-[-0.04em]">agentcut</span>
        </a>
        <div class="ml-2 hidden items-center gap-1 sm:flex">
          <NavLink href="/packs" active={path.startsWith("/packs")}>Packs</NavLink>
        </div>
        <div class="ml-auto flex items-center gap-1">
          <a href="/packs" class="rounded-full px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-white/10 hover:text-foreground sm:hidden">Packs</a>
          <a href={REPO_URL} class="grid size-9 place-items-center rounded-full text-muted-foreground transition-[background-color,color] duration-150 hover:bg-white/10 hover:text-foreground" aria-label="agentcut on GitHub">
            <GitHubMark class="size-[1.1rem]" />
          </a>
          {user ? (
            <a href="/account" class="flex items-center gap-2 rounded-full py-1 pl-1 pr-3 text-sm font-medium transition-[background-color] duration-150 hover:bg-white/10" aria-current={path === "/account" ? "page" : undefined}>
              <Avatar login={user.login} url={user.avatarUrl} size="size-7" />
              <span class="hidden max-w-32 truncate sm:inline">{user.login}</span>
            </a>
          ) : (
            <a href={`/login?next=${encodeURIComponent(path)}`} class={btn.ghost}>Sign in</a>
          )}
        </div>
      </nav>
    </header>
  );
}

function Footer() {
  return (
    <footer class="mt-24 border-t border-white/8">
      <div class="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-10 sm:flex-row sm:items-center sm:justify-between">
        <div class="flex items-center gap-3">
          <img src="/icon.svg" alt="" width="24" height="24" class="size-6" />
          <p class="text-sm text-muted-foreground">agentcut — a local video editor for you and your coding agent.</p>
        </div>
        <nav aria-label="Footer" class="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
          <a href="/packs" class="hover:text-foreground">Packs</a>
          <a href={`${REPO_URL}#readme`} class="hover:text-foreground">Documentation</a>
          <a href={REPO_URL} class="inline-flex items-center gap-2 hover:text-foreground">
            <GitHubMark class="size-4" />
            GitHub
          </a>
        </nav>
      </div>
    </footer>
  );
}
