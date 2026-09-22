"use client";

import * as React from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "cn";

/**
 * A section that folds away.
 *
 * It stays a real `<details>`/`<summary>`: the browser does the opening, find-in-page
 * reaches the closed content, and the keyboard works without a line of JS. What this
 * adds is the part the native element gets wrong on a dark surface — the black
 * triangle, a summary with no hit area, and a box whose corner does not match the
 * cards beside it.
 *
 * `variant="card"` is a panel in its own right and matches `<Card>`: same radius, same
 * hairline, same inset, so a rail of them lines up. `variant="plain"` is a line of text
 * that opens, for a detail inside a panel that already has its own edge.
 *
 * `heading` makes the summary the section's heading, which is what it is whenever the
 * thing inside would otherwise carry one of its own. The row is then a single heading
 * element, the one exception `<summary>`'s content model allows.
 */
export function Disclosure({
  summary,
  aside,
  heading,
  variant = "card",
  className,
  summaryClassName,
  contentClassName,
  children,
  ...props
}: Omit<React.ComponentProps<"details">, "title"> & {
  /** The visible name of the section. */
  summary: React.ReactNode;
  /** A count or status that belongs on the summary row, at its trailing edge. */
  aside?: React.ReactNode;
  /** Which heading this section is, when it is one. */
  heading?: "h2" | "h3";
  variant?: "card" | "plain";
  summaryClassName?: string;
  contentClassName?: string;
}) {
  const card = variant === "card";
  const Row = heading ?? "span";
  return (
    <details
      data-slot="disclosure"
      className={cn(
        "group/disclosure min-w-0",
        card && "rounded-3xl bg-card p-1 ring-1 ring-foreground/10",
        className,
      )}
      {...props}
    >
      <summary
        className={cn(
          // The native marker is a black triangle no dark theme can reach, so it goes
          // and a `currentColor` chevron takes its place. The radius is the panel's
          // own minus its inset, so the row sits concentric inside it.
          "block cursor-pointer list-none rounded-[31px] transition-colors duration-150 outline-none select-none",
          "focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none [&::-webkit-details-marker]:hidden",
          card
            ? "px-3 py-2.5 text-sm font-medium hover:bg-white/5"
            : "px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground",
          summaryClassName,
        )}
      >
        <Row className="flex min-w-0 items-center gap-2">
          <ChevronRight
            aria-hidden
            className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-open/disclosure:rotate-90 motion-reduce:transition-none"
          />
          <span className="min-w-0 flex-1 truncate text-left">{summary}</span>
          {aside ? <span className="shrink-0 text-xs font-normal text-muted-foreground">{aside}</span> : null}
        </Row>
      </summary>
      <div className={cn("min-w-0", card ? "px-3 pt-1 pb-3" : "px-2 pt-2 pb-1", contentClassName)}>
        {children}
      </div>
    </details>
  );
}
