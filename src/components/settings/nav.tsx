"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "cn";
import { SETTINGS_SECTIONS } from "./sections";

/**
 * The rail. Wide enough and it stands beside the page; narrow and it wraps into
 * chips above it — no scroller, because six labels that wrap are six labels you can
 * see, and a horizontal scroller hides half of them behind a gesture.
 *
 * Plain links, so a section is a URL: reloadable, bookmarkable, and something an
 * error message or a piece of documentation can point at.
 */
export function SettingsNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Settings sections" className="md:w-52 md:shrink-0">
      <ul className="flex flex-wrap gap-1.5 md:sticky md:top-24 md:flex-col md:gap-0.5">
        {SETTINGS_SECTIONS.map((section) => {
          const active = pathname === section.href;
          const Icon = section.icon;
          return (
            <li key={section.id}>
              <Link
                href={section.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2 rounded-full px-3 py-2 text-sm transition-colors md:rounded-xl md:w-full",
                  "hover:bg-foreground/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                  active ? "bg-foreground/10 font-medium text-foreground" : "text-muted-foreground",
                )}
              >
                <Icon aria-hidden className={cn("size-4 shrink-0", active && "text-primary")} />
                {section.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
