import { CircleCheck, CircleAlert, CircleDashed, Loader2 } from "lucide-react";
import { cn } from "@/common/lib/utils";
import { BUSY, PROJECT_STATUS_LABELS } from "@agentcut/core/modules/project/data";

export function ProjectStatus({ status, stage, running = false, className }: {
  status: string;
  stage?: string | null;
  running?: boolean;
  className?: string;
}) {
  const busy = running || BUSY.has(status);
  const failed = !busy && status === "error";
  let Icon = CircleDashed;
  if (status === "ready") Icon = CircleCheck;
  if (failed) Icon = CircleAlert;
  if (busy) Icon = Loader2;
  let label = PROJECT_STATUS_LABELS[status] || status;
  if (running && !BUSY.has(status)) label = "Working";
  if (running && stage) label = stage;

  return (
    <span className={cn(
      "inline-flex max-w-full shrink-0 items-center gap-1.5 rounded-full bg-foreground/5 px-2.5 py-1 text-xs font-medium leading-4 text-foreground/80 ring-1 ring-inset ring-foreground/10",
      busy && "bg-primary/10 text-primary ring-primary/20",
      failed && "bg-destructive/10 text-destructive ring-destructive/20",
      className,
    )}>
      <Icon aria-hidden strokeWidth={1.75} className={cn("size-3.5 shrink-0", busy && "motion-safe:animate-spin")} />
      <span className="truncate">{label}</span>
    </span>
  );
}
