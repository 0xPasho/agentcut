"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { api, type ProjectSummary } from "@/lib/client";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  ready: "default",
  error: "destructive",
  new: "outline",
};

export function ProjectRow({ project }: { project: ProjectSummary }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();

  const remove = () =>
    start(async () => {
      await api.deleteProject(project.id);
      router.refresh();
    });

  return (
    <Card className="flex flex-row items-center gap-3 px-2 py-2 transition-colors hover:bg-white/[0.07]">
      <Link
        href={`/p/${project.id}`}
        className="flex min-w-0 flex-1 items-center gap-4 rounded-xl px-2 py-1 outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{project.name}</p>
          <p className="font-mono text-xs text-muted-foreground">{project.id}</p>
        </div>
        {project.clipCount ? (
          <span className="shrink-0 text-xs text-muted-foreground">{project.clipCount} clips</span>
        ) : null}
        <Badge variant={STATUS_VARIANT[project.status] ?? "secondary"}>{project.status}</Badge>
      </Link>

      {confirming ? (
        <div className="flex shrink-0 gap-1">
          <Button size="sm" variant="destructive" disabled={pending} onClick={remove}>
            Delete
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={`Delete ${project.name}`}
          onClick={() => setConfirming(true)}
        >
          <Trash2 className="size-4" />
        </Button>
      )}
    </Card>
  );
}
