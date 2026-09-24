import type { ReactNode } from "react";
import { cn } from "cn";

/**
 * One heading shape for every section: the name, a sentence saying what the
 * section decides, and whatever single action starts a new one.
 */
export function SectionHeader({ title, children, action, eyebrow }: { title: string; children?: ReactNode; action?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
      <div className="flex min-w-0 flex-col gap-1">
        {eyebrow && <div className="text-xs text-muted-foreground">{eyebrow}</div>}
        <h2 className="font-heading text-2xl tracking-[-0.02em]">{title}</h2>
        {children && <p className="max-w-prose text-sm text-muted-foreground">{children}</p>}
      </div>
      {action && <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div>}
    </header>
  );
}

/**
 * A solid surface in the content layer: a card, never glass. Everything on these
 * pages that groups controls is one of these, so the corner, the hairline and the
 * inset are decided once.
 */
export function Panel({ className, children, as: Tag = "div", ...props }: { className?: string; children: ReactNode; as?: "div" | "section" | "form" | "fieldset" | "li" | "article" } & Omit<React.HTMLAttributes<HTMLElement>, "className" | "children">) {
  return (
    <Tag className={cn("rounded-2xl bg-card px-4 py-4 ring-1 ring-foreground/10", className)} {...props}>
      {children}
    </Tag>
  );
}

/** The small heading inside a panel: what this group is, and one line of why. */
export function PanelHeading({ title, children, action, icon }: { title: ReactNode; children?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
      {icon && <span aria-hidden className="mt-0.5 shrink-0 text-muted-foreground">{icon}</span>}
      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-medium">{title}</h3>
        {children && <p className="mt-0.5 max-w-prose text-sm text-muted-foreground">{children}</p>}
      </div>
      {action}
    </div>
  );
}

/** A section that has nothing in it yet: what this place is, and the one way to fill it. */
export function Empty({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-2xl bg-card px-5 py-8 ring-1 ring-foreground/10">
      <p className="text-sm font-medium">{title}</p>
      <p className="max-w-prose text-sm text-muted-foreground">{children}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/** A row of skeleton panels while the workspace loads: the shape of the page, not a spinner. */
export function Loading({ rows = 3, label }: { rows?: number; label: string }) {
  return (
    <div role="status" aria-label={label} className="flex flex-col gap-2">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} aria-hidden className="h-16 rounded-2xl bg-card ring-1 ring-foreground/5 motion-safe:animate-pulse" />
      ))}
      <span className="sr-only">{label}</span>
    </div>
  );
}

/** The one place an error from a save is shown on a page. */
export function ErrorLine({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <p role="alert" className="text-sm text-destructive">{children}</p>;
}
