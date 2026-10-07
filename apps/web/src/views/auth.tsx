import type { Child } from "hono/jsx";
import type { User } from "../env";
import type { PackListing } from "../lib/packs";
import { isoDate, longDate, timeAgo } from "../lib/format";
import { CheckIcon, KeyIcon, LogOutIcon, ShieldAlertIcon, TerminalIcon, XIcon } from "./icons";
import { GitHubMark } from "./marks";
import { PackCard } from "./pack-card";
import { Avatar, Command, btn, card } from "./ui";

function Panel({ children, wide = false }: { children: Child; wide?: boolean }) {
  return (
    <div class={`mx-auto px-6 pt-16 sm:pt-24 ${wide ? "max-w-xl" : "max-w-md"}`}>
      <div class={`${card} p-7 sm:p-8`}>{children}</div>
    </div>
  );
}

export function LoginPage(props: { next: string; github: boolean; dev: boolean; error?: string; reason?: string }) {
  return (
    <Panel>
      <img src="/icon.svg" alt="" width="44" height="44" class="size-11" />
      <h1 class="mt-6 text-2xl font-semibold tracking-[-0.02em]">Sign in to agentcut</h1>
      <p class="mt-2 text-sm leading-relaxed text-muted-foreground text-pretty">
        {props.reason ?? "An account publishes packs and signs in the CLI. Editing and rendering never need one."}
      </p>
      {props.error ? (
        <p role="alert" class="mt-5 flex gap-2 rounded-2xl bg-destructive/12 px-4 py-3 text-sm text-destructive">
          <ShieldAlertIcon class="mt-0.5 size-4 shrink-0" />
          {props.error}
        </p>
      ) : null}
      <div class="mt-7 space-y-6">
        {props.github ? (
          <a href={`/login/github?next=${encodeURIComponent(props.next)}`} class={`${btn.primary} w-full`}>
            <GitHubMark class="size-4" />
            Continue with GitHub
          </a>
        ) : null}
        {props.dev ? (
          <form method="post" action="/login/dev" class="space-y-3">
            <input type="hidden" name="next" value={props.next} />
            <div class="flex items-center justify-between">
              <label for="login" class="text-sm font-medium">Username</label>
              <span class="rounded-full bg-accent/15 px-2 py-0.5 text-[0.7rem] font-medium text-accent">Local development</span>
            </div>
            <input id="login" name="login" required autocomplete="username" spellcheck={false} autocapitalize="off"
              pattern="[A-Za-z0-9](?:[A-Za-z0-9\-]{0,37}[A-Za-z0-9])?" placeholder="octocat"
              class="h-11 w-full rounded-full border border-input bg-white/[0.04] px-4 text-base outline-none shadow-[inset_0_1px_3px_rgb(0_0_0/0.25)] placeholder:text-muted-foreground/70 focus:border-ring focus:ring-3 focus:ring-ring/30 sm:text-sm" />
            <p class="text-xs text-muted-foreground">Signs in as this user, creating it if needed. Only offered when DEV_LOGIN is on.</p>
            <button type="submit" class={`${props.github ? btn.outline : btn.primary} w-full`}>Sign in</button>
          </form>
        ) : null}
        {!props.github && !props.dev ? (
          <p class="rounded-2xl bg-white/[0.04] px-4 py-3 text-sm text-muted-foreground">
            Sign-in is not configured on this server yet.
          </p>
        ) : null}
      </div>
    </Panel>
  );
}

export type DeviceState =
  | { kind: "enter"; code?: string; error?: string }
  | { kind: "confirm"; code: string; expiresAt: number }
  | { kind: "approved" }
  | { kind: "denied" };

export function DevicePage({ state, user }: { state: DeviceState; user: User }) {
  if (state.kind === "approved") {
    return (
      <Panel>
        <span class="grid size-11 place-items-center rounded-2xl bg-success/15 text-success"><CheckIcon class="size-5" strokeWidth={2.25} /></span>
        <h1 class="mt-6 text-2xl font-semibold tracking-[-0.02em]">Your terminal is signed in</h1>
        <p class="mt-2 text-sm leading-relaxed text-muted-foreground">Go back to the terminal; it continues on its own. You can close this tab.</p>
        <a href="/account" class={`${btn.outline} mt-7`}>Manage tokens</a>
      </Panel>
    );
  }
  if (state.kind === "denied") {
    return (
      <Panel>
        <span class="grid size-11 place-items-center rounded-2xl bg-white/6"><XIcon class="size-5" /></span>
        <h1 class="mt-6 text-2xl font-semibold tracking-[-0.02em]">Sign-in denied</h1>
        <p class="mt-2 text-sm leading-relaxed text-muted-foreground">The terminal that asked was not signed in. Nothing was shared with it.</p>
      </Panel>
    );
  }
  if (state.kind === "enter") {
    return (
      <Panel>
        <span class="grid size-11 place-items-center rounded-2xl bg-white/6"><TerminalIcon class="size-5" /></span>
        <h1 class="mt-6 text-2xl font-semibold tracking-[-0.02em]">Sign in the CLI</h1>
        <p class="mt-2 text-sm leading-relaxed text-muted-foreground">Enter the code <code class="font-mono text-foreground">agentcut login</code> printed in your terminal.</p>
        <form method="get" action="/device" class="mt-6 space-y-3">
          <label for="code" class="text-sm font-medium">Code</label>
          <input id="code" name="code" value={state.code ?? ""} required autocomplete="one-time-code" spellcheck={false} autocapitalize="characters"
            placeholder="ABCD-EFGH" aria-invalid={state.error ? "true" : undefined} aria-describedby={state.error ? "code-error" : undefined}
            class="h-12 w-full rounded-full border border-input bg-white/[0.04] px-5 text-center font-mono text-lg uppercase tracking-[0.2em] outline-none shadow-[inset_0_1px_3px_rgb(0_0_0/0.25)] placeholder:text-muted-foreground/50 focus:border-ring focus:ring-3 focus:ring-ring/30 aria-invalid:border-destructive/60" />
          {state.error ? <p id="code-error" class="text-sm text-destructive">{state.error}</p> : null}
          <button type="submit" class={`${btn.primary} w-full`}>Continue</button>
        </form>
      </Panel>
    );
  }
  const minutes = Math.max(1, Math.round((state.expiresAt - Date.now()) / 60_000));
  return (
    <Panel>
      <span class="grid size-11 place-items-center rounded-2xl bg-white/6"><TerminalIcon class="size-5" /></span>
      <h1 class="mt-6 text-2xl font-semibold tracking-[-0.02em]">Sign in the CLI?</h1>
      <p class="mt-2 text-sm leading-relaxed text-muted-foreground text-pretty">
        A terminal asked to act as you: publish packs under your name and read your account.
        Approve only if it is showing this same code.
      </p>
      <p class="mt-6 rounded-2xl border border-white/10 bg-black/40 py-5 text-center font-mono text-3xl font-medium tracking-[0.18em] tabular-nums" aria-label={`Code ${state.code.split("").join(" ")}`}>
        {state.code}
      </p>
      <div class="mt-6 flex items-center gap-3 rounded-2xl bg-white/[0.04] px-4 py-3">
        <Avatar login={user.login} url={user.avatarUrl} size="size-8" />
        <div class="min-w-0 text-sm">
          <p class="text-muted-foreground">Signing in as</p>
          <p class="truncate font-medium">{user.login}</p>
        </div>
        <span class="ml-auto text-xs text-muted-foreground">Expires in {minutes} min</span>
      </div>
      <form method="post" action="/device" class="mt-6 grid grid-cols-2 gap-3">
        <input type="hidden" name="code" value={state.code} />
        <button type="submit" name="decision" value="deny" class={btn.outline}>Deny</button>
        <button type="submit" name="decision" value="approve" class={btn.primary}>Approve</button>
      </form>
    </Panel>
  );
}

export type TokenRow = { id: number; label: string; createdAt: number; lastUsedAt: number | null };

export function AccountPage({ user, packs, tokens, notice }: { user: User; packs: PackListing[]; tokens: TokenRow[]; notice?: string }) {
  return (
    <div class="mx-auto max-w-6xl px-6 pt-14 sm:pt-20">
      <div class="flex flex-wrap items-center gap-5">
        <Avatar login={user.login} url={user.avatarUrl} size="size-16" />
        <div class="min-w-0">
          <h1 class="truncate text-3xl font-semibold tracking-[-0.02em]">{user.name ?? user.login}</h1>
          {user.name && user.name !== user.login ? <p class="mt-1 text-sm text-muted-foreground">{user.login}</p> : null}
        </div>
        <form method="post" action="/logout" class="ml-auto">
          <button type="submit" class={btn.outline}>
            <LogOutIcon class="size-4" />
            Sign out
          </button>
        </form>
      </div>
      {notice ? <p role="status" class="mt-6 rounded-2xl bg-success/10 px-4 py-3 text-sm text-success">{notice}</p> : null}

      <section class="mt-14">
        <h2 class="text-xl font-semibold tracking-[-0.01em]">Your packs</h2>
        {packs.length ? (
          <div class="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{packs.map((p) => <PackCard pack={p} />)}</div>
        ) : (
          <div class={`${card} mt-5 p-7`}>
            <p class="font-medium">You have not published a pack yet</p>
            <p class="mt-1 text-sm text-muted-foreground">Sign in the CLI, then publish a folder with a pack.json.</p>
            <div class="mt-5 max-w-md space-y-2">
              <Command text="agentcut login" />
              <Command text="agentcut packs publish ./my-pack" />
            </div>
          </div>
        )}
      </section>

      <section class="mt-14">
        <h2 class="text-xl font-semibold tracking-[-0.01em]">API tokens</h2>
        <p class="mt-1 text-sm text-muted-foreground">Each <code class="font-mono text-foreground">agentcut login</code> creates one. Revoke a token to sign that terminal out.</p>
        {tokens.length ? (
          <ul class={`${card} mt-5 divide-y divide-white/8 overflow-hidden`}>
            {tokens.map((t) => (
              <li class="flex flex-wrap items-center gap-4 px-6 py-4">
                <span class="grid size-9 shrink-0 place-items-center rounded-xl bg-white/6 text-muted-foreground"><KeyIcon class="size-4" /></span>
                <div class="min-w-0 flex-1">
                  <p class="truncate font-medium">{t.label}</p>
                  <p class="mt-0.5 text-xs text-muted-foreground">
                    Created <time datetime={isoDate(t.createdAt)}>{longDate(t.createdAt)}</time>
                    {" · "}
                    {t.lastUsedAt ? <>Last used <time datetime={isoDate(t.lastUsedAt)}>{timeAgo(t.lastUsedAt)}</time></> : "Never used"}
                  </p>
                </div>
                <form method="post" action={`/account/tokens/${t.id}/revoke`}>
                  <button type="submit" class={btn.destructive}>Revoke</button>
                </form>
              </li>
            ))}
          </ul>
        ) : (
          <div class={`${card} mt-5 p-7 text-sm text-muted-foreground`}>No active tokens.</div>
        )}
      </section>
    </div>
  );
}

export function MessagePage({ title, children }: { title: string; children: Child }) {
  return (
    <Panel>
      <h1 class="text-2xl font-semibold tracking-[-0.02em]">{title}</h1>
      <div class="mt-3 text-sm leading-relaxed text-muted-foreground">{children}</div>
      <a href="/" class={`${btn.outline} mt-7`}>Go to the home page</a>
    </Panel>
  );
}
