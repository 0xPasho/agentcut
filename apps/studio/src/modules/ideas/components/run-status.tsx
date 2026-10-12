"use client";
import { AlertCircle, CheckCircle2, CircleSlash, Loader2 } from "lucide-react";
import { cn } from "cn";
import type { RunStatus } from "@agentcut/core/modules/ideas/types";

const LABEL: Record<RunStatus, string> = {
  running: "Writing", done: "Brief ready", error: "Failed", stopped: "Stopped", interrupted: "Interrupted",
};

export function RunStatusIcon({ status, className }: { status: RunStatus; className?: string }) {
  const size = cn("size-3.5 shrink-0", className);
  if (status === "running") return <Loader2 aria-label={LABEL[status]} className={cn(size, "animate-spin text-primary motion-reduce:animate-none")} />;
  if (status === "done") return <CheckCircle2 aria-label={LABEL[status]} className={cn(size, "text-emerald-400")} />;
  if (status === "error") return <AlertCircle aria-label={LABEL[status]} className={cn(size, "text-destructive")} />;
  return <CircleSlash aria-label={LABEL[status]} className={cn(size, "text-muted-foreground")} />;
}

export const runStatusLabel = (status: RunStatus) => LABEL[status];
