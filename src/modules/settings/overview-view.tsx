"use client";
import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { SETTINGS_SECTIONS } from "./data";
import { useWorkspaceSettings } from "./hooks";
import { summarise } from "./lib";

/**
 * The front page of settings: what each section holds right now, so the answer to
 * "where did I put that" is on screen instead of behind six clicks. On a narrow
 * screen it is also the menu — the rail wraps above it, and this repeats it with
 * the detail that makes a section worth opening.
 */
export function SettingsOverview() {
  const { data, error } = useWorkspaceSettings();
  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h2 className="font-heading text-2xl tracking-[-0.02em]">Your workspace</h2>
        <p className="max-w-prose text-sm text-muted-foreground">
          Rules, names, preferences and the agent that runs them. These apply to every project;
          a project can add its own from the editor.
        </p>
      </header>

      <ul className="flex flex-col gap-2">
        {SETTINGS_SECTIONS.map((section) => {
          const Icon = section.icon;
          return (
            <li key={section.id}>
              <Link
                href={section.href}
                className="group flex items-center gap-3 rounded-2xl bg-card px-4 py-3.5 ring-1 ring-foreground/10 transition-[box-shadow,background-color] motion-reduce:transition-none hover:bg-foreground/[0.04] hover:ring-foreground/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-xl bg-foreground/5 text-muted-foreground group-hover:text-primary">
                  <Icon className="size-4.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-sm font-medium">{section.label}</span>
                    <span className="text-xs text-muted-foreground">{data ? summarise(section.id, data) : "…"}</span>
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">{section.blurb}</span>
                </span>
                <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" />
              </Link>
            </li>
          );
        })}
      </ul>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </section>
  );
}
