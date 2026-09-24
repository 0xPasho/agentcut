"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, CircleAlert, Film, Loader2, MoreHorizontal, Trash2 } from "lucide-react";
import { Button } from "@/common/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/common/ui/popover";
import { api, type ProjectSummary } from "@/common/api/client";
import { BUSY } from "../data";

export function ProjectRow({ project }: { project: ProjectSummary }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failedThumbnail, setFailedThumbnail] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const busy = BUSY.has(project.status);
  const videos = project.sequenceCount ?? 0;

  const remove = () => start(async () => {
    setError(null);
    try {
      await api.deleteProject(project.id);
      setConfirming(false);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to delete this project. Try again.");
    }
  });

  return (
    <li className="group flex items-center gap-2 py-2 hover:bg-muted/30 focus-within:bg-muted/30 sm:gap-4">
      <Link href={`/p/${project.id}`} className="flex min-w-0 flex-1 items-center gap-3 rounded-md py-1 pr-1 outline-none focus-visible:ring-2 focus-visible:ring-ring sm:gap-4">
        <div aria-hidden className="relative flex aspect-video w-16 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted/60 outline outline-1 -outline-offset-1 outline-white/10 sm:w-24">
          <Film strokeWidth={1.5} className="size-5 text-muted-foreground" />
          {project.thumbnailPath && failedThumbnail !== project.thumbnailPath && (
            // Local source previews use the existing cached media thumbnail service.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/files/thumb?path=${encodeURIComponent(project.thumbnailPath)}`} alt="" loading="lazy" onError={() => setFailedThumbnail(project.thumbnailPath ?? null)} className="absolute inset-0 size-full object-cover" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p title={project.name} className="truncate text-sm font-medium">{project.name}</p>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-relaxed text-muted-foreground">
            {videos > 0 && <span>{videos} {videos === 1 ? "video" : "videos"}</span>}
            {videos > 0 && project.clipCount > 0 && <span aria-hidden>·</span>}
            {project.clipCount > 0 && <span>{project.clipCount} {project.clipCount === 1 ? "clip" : "clips"}</span>}
            {(videos > 0 || project.clipCount > 0) && <span aria-hidden>·</span>}
            <span className={`inline-flex items-center gap-1 capitalize ${project.status === "error" ? "text-destructive" : ""}`}>
              {project.status === "ready" && <Check aria-hidden className="size-3" />}
              {project.status === "error" && <CircleAlert aria-hidden className="size-3" />}
              {busy && <Loader2 aria-hidden className="size-3 motion-safe:animate-spin" />}
              {project.status}
            </span>
          </div>
        </div>
      </Link>
      <Popover open={confirming} onOpenChange={open => { if (!pending) { setConfirming(open); setError(null); } }}>
        <PopoverTrigger render={<Button variant="ghost" size="icon" className="mr-1 size-10 text-muted-foreground" aria-label={`Actions for ${project.name}`}><MoreHorizontal aria-hidden /></Button>} />
        <PopoverContent side="bottom" align="end" className="w-72 max-w-[calc(100vw-2rem)] rounded-xl p-4">
          <p className="text-sm font-medium">Delete project?</p>
          <p className="mt-1 break-words text-xs leading-relaxed text-muted-foreground">“{project.name}” will be removed from your workspace.</p>
          {error && <p role="alert" className="mt-2 text-xs text-destructive">{error}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => setConfirming(false)}>Cancel</Button>
            <Button size="sm" variant="destructive" disabled={pending} onClick={remove}><Trash2 aria-hidden />{pending ? "Deleting…" : "Delete project"}</Button>
          </div>
        </PopoverContent>
      </Popover>
    </li>
  );
}
