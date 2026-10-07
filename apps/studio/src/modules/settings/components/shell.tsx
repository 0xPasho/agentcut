"use client";
import { useEffect, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft, HardDrive } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/common/ui/button";
import { Glass } from "@/common/ui/glass";
import { WORKSPACE_SECTIONS } from "@agentcut/core/modules/settings/data";
import { SECTION_ICONS } from "../data";
import { WorkspaceProvider, useWorkspaceSettings } from "../hooks";
import { summarise } from "@agentcut/core/modules/settings/lib";

/**
 * The one shell for everything that belongs to the person (decision 130): the
 * library, the profile, rules, names, packs, templates, agents and the machine. A
 * glass header above, a rail beside, and the page in the middle. Glass belongs to
 * the navigation layer; what the rail points at stays solid.
 */
export function WorkspaceShell({ children }: { children: ReactNode }) {
  return (
    <WorkspaceProvider>
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-6 px-4 pt-4 pb-14 sm:px-6">
        <header className="sticky top-4 z-20">
          <Glass shape="capsule" thickness="thick" className="flex items-center gap-2 px-3 py-2.5 sm:gap-3 sm:px-4">
            <Button aria-label="Back to projects" variant="ghost" size="icon" nativeButton={false} render={<Link href="/" />}>
              <ArrowLeft className="size-4" />
            </Button>
            <h1 className="text-sm font-medium">Workspace</h1>
            <span className="hidden items-center gap-1.5 border-l border-white/10 pl-3 text-xs text-muted-foreground sm:inline-flex">
              <HardDrive aria-hidden className="size-3.5" />Everything here applies to every project
            </span>
          </Glass>
        </header>

        <div className="flex flex-col gap-6 md:flex-row md:items-start md:gap-10">
          <Rail />
          <main className="flex min-w-0 flex-1 flex-col gap-6">{children}</main>
        </div>
      </div>
    </WorkspaceProvider>
  );
}

/**
 * The rail. Wide enough and it stands beside the page with what each section holds
 * written under its name, so "where did I put that" is answered without opening
 * anything. Narrow, it wraps into chips above the page — no scroller, because eight
 * labels that wrap are eight labels you can see, and a horizontal scroller hides
 * half of them behind a gesture.
 *
 * Plain links, so a section is a URL: reloadable, bookmarkable, and something an
 * error message or a piece of documentation can point at.
 */
function Rail() {
  const pathname = usePathname();
  const { data, setError } = useWorkspaceSettings();
  // An error belongs to the page it happened on; it does not follow you to the next one.
  useEffect(() => { setError(""); }, [pathname, setError]);
  const current = WORKSPACE_SECTIONS.filter((s) => pathname === s.href || pathname.startsWith(`${s.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0];
  return (
    <nav aria-label="Workspace sections" className="md:w-56 md:shrink-0">
      <ul className="flex flex-wrap gap-1.5 md:sticky md:top-24 md:flex-col md:gap-0.5">
        {WORKSPACE_SECTIONS.map((section) => {
          const active = current?.id === section.id;
          const Icon = SECTION_ICONS[section.icon];
          const summary = data ? summarise(section.id, data) : "";
          return (
            <li key={section.id}>
              <Link
                href={section.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2.5 rounded-full px-3 py-2 text-sm transition-colors motion-reduce:transition-none md:w-full md:rounded-xl md:px-2.5",
                  "hover:bg-foreground/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                  active ? "bg-foreground/10 text-foreground" : "text-muted-foreground",
                )}
              >
                <Icon aria-hidden className={cn("size-4 shrink-0", active && "text-primary")} strokeWidth={active ? 2 : 1.75} />
                <span className="flex min-w-0 flex-col">
                  <span className={cn("leading-tight", active && "font-medium")}>{section.label}</span>
                  {/* Two lines only where there is room for two; a chip says its name and nothing else. */}
                  <span aria-hidden={!summary} title={summary} className="hidden truncate text-xs leading-tight text-muted-foreground/80 md:block">{summary || " "}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
