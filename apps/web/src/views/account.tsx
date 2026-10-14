import type { Child } from "hono/jsx";
import type { User } from "../env";
import type { PackListing } from "../lib/packs";
import { LogOutIcon, PackageIcon } from "./icons";
import { PackCard } from "./pack-card";
import { Alert, Avatar, btn, card } from "./ui";

function Panel({ children, wide = false }: { children: Child; wide?: boolean }) {
  return (
    <div class={`mx-auto px-6 pt-16 sm:pt-24 ${wide ? "max-w-xl" : "max-w-md"}`}>
      <div class={`${card} p-7 sm:p-8`}>{children}</div>
    </div>
  );
}

/** Only reached when this server has no Clerk keys: there is nothing to sign in with. */
export function SignInPage({ configured }: { configured: boolean }) {
  return (
    <Panel>
      <img src="/icon.svg" alt="" width="44" height="44" class="size-11" />
      <h1 class="mt-6 text-2xl font-semibold tracking-[-0.02em]">Sign in to agentcut</h1>
      <p class="mt-2 text-sm leading-relaxed text-muted-foreground text-pretty">
        An account is needed only to submit a pack. Browsing, installing, editing and rendering never ask for one.
      </p>
      <div class="mt-7">
        <Alert kind="error">
          {configured
            ? "Sign-in did not start. Try again in a moment."
            : "Sign-in is not configured on this server yet."}
        </Alert>
      </div>
      <a href="/packs" class={`${btn.outline} mt-6`}>Browse packs</a>
    </Panel>
  );
}

const field =
  "h-11 w-full rounded-full border border-input bg-white/[0.04] px-4 text-base outline-none shadow-[inset_0_1px_3px_rgb(0_0_0/0.25)] placeholder:text-muted-foreground/70 focus:border-ring focus:ring-3 focus:ring-ring/30 aria-invalid:border-destructive/60 sm:text-sm";

export function SubmitPage({
  user,
  repo,
  folder,
  error,
  issues,
}: {
  user: User;
  repo: string;
  folder: string;
  error?: string;
  issues?: unknown;
}) {
  const problems = Array.isArray(issues)
    ? (issues as Array<{ path?: unknown[]; message?: string }>).slice(0, 8).map((i) => `${(i.path ?? []).join(".") || "pack.json"}: ${i.message ?? ""}`)
    : [];
  return (
    <div class="mx-auto max-w-xl px-6 pt-14 sm:pt-20">
      <h1 class="text-3xl font-semibold tracking-[-0.02em] text-balance sm:text-4xl">Submit a pack</h1>
      <p class="mt-4 text-base leading-relaxed text-muted-foreground text-pretty">
        A pack is a public GitHub repository with a <code class="font-mono text-foreground">pack.json</code> in it, or a
        folder in one. We read it, pin the commit it is on, and list it. The files stay in your repository; installs
        come straight from GitHub.
      </p>
      <div class={`${card} mt-8 p-7 sm:p-8`}>
        {error ? (
          <div class="mb-7">
            <Alert kind="error">
              {error}
              {problems.length ? (
                <ul class="mt-2 list-disc space-y-1 pl-4 font-mono text-xs">{problems.map((p) => <li>{p}</li>)}</ul>
              ) : null}
            </Alert>
          </div>
        ) : null}
        <form method="post" action="/submit" class="space-y-7">
          <div class="space-y-2.5">
            <label for="repo" class="block text-sm font-medium">Repository</label>
            <input id="repo" name="repo" value={repo} required spellcheck={false} autocapitalize="off" autocomplete="off"
              placeholder={`github.com/${user.login ?? "you"}/my-pack`} aria-invalid={error ? "true" : undefined} class={field} />
            <p class="text-xs leading-relaxed text-muted-foreground">
              Public, so anybody can install it. It is listed under its owner on GitHub. A link to a folder works too.
            </p>
          </div>
          <div class="space-y-2.5">
            <label for="folder" class="block text-sm font-medium">
              Folder <span class="font-normal text-muted-foreground">(optional)</span>
            </label>
            <input id="folder" name="folder" value={folder} spellcheck={false} autocapitalize="off" autocomplete="off"
              placeholder="packs/news-desk" class={field} />
            <p class="text-xs leading-relaxed text-muted-foreground">
              Where <code class="font-mono text-foreground/85">pack.json</code> is, when it is not at the root.
            </p>
          </div>
          <button type="submit" class={`${btn.primary} w-full`}>
            <PackageIcon class="size-4" strokeWidth={2} />
            Read the repository and list it
          </button>
        </form>
      </div>
      <p class="mt-6 text-sm leading-relaxed text-muted-foreground text-pretty">
        Later, a new version is one commit away: bump <code class="font-mono text-foreground/85">version</code> in
        pack.json and press Check for updates on the pack's page.
      </p>
    </div>
  );
}

export function AccountPage({ user, packs, notice }: { user: User; packs: PackListing[]; notice?: string }) {
  return (
    <div class="mx-auto max-w-6xl px-6 pt-14 sm:pt-20">
      <div class="flex flex-wrap items-center gap-5">
        <Avatar login={user.login ?? user.name ?? "?"} url={user.avatarUrl} size="size-16" />
        <div class="min-w-0">
          <h1 class="truncate text-3xl font-semibold tracking-[-0.02em]">{user.name ?? user.login}</h1>
          {user.login && user.name !== user.login ? <p class="mt-1 text-sm text-muted-foreground">{user.login}</p> : null}
        </div>
        <form method="post" action="/logout" class="ml-auto">
          <button type="submit" class={btn.outline}>
            <LogOutIcon class="size-4" />
            Sign out
          </button>
        </form>
      </div>
      {notice ? <div class="mt-6"><Alert kind="ok">{notice}</Alert></div> : null}

      <section class="mt-14">
        <div class="flex flex-wrap items-center gap-4">
          <h2 class="text-xl font-semibold tracking-[-0.01em]">Your packs</h2>
          {packs.length ? <a href="/submit" class={`${btn.smallOutline} ml-auto`}>Submit another</a> : null}
        </div>
        {packs.length ? (
          <div class="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{packs.map((p) => <PackCard pack={p} />)}</div>
        ) : (
          <div class={`${card} mt-5 p-7`}>
            <p class="font-medium">You have not submitted a pack yet</p>
            <p class="mt-1 text-sm leading-relaxed text-muted-foreground text-pretty">
              Push a folder with a <code class="font-mono text-foreground/85">pack.json</code> to a public repository,
              then point us at it. Nothing is uploaded here.
            </p>
            <a href="/submit" class={`${btn.primary} mt-6`}>
              <PackageIcon class="size-4" strokeWidth={2} />
              Submit a pack
            </a>
          </div>
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
