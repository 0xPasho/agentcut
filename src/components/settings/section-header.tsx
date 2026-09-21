import type { ReactNode } from "react";

/**
 * One heading shape for every settings section: the name, a sentence saying what
 * the section decides, and whatever single action starts a new one.
 */
export function SectionHeader({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
      <div className="flex min-w-0 flex-col gap-1">
        <h2 className="font-heading text-2xl tracking-[-0.02em]">{title}</h2>
        <p className="max-w-prose text-sm text-muted-foreground">{children}</p>
      </div>
      {action}
    </header>
  );
}

/** A section that has nothing in it yet: what this place is, and the one way to fill it. */
export function Empty({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-2xl bg-card px-4 py-8 ring-1 ring-foreground/10">
      <p className="text-sm font-medium">{title}</p>
      <p className="max-w-prose text-sm text-muted-foreground">{children}</p>
      {action}
    </div>
  );
}
