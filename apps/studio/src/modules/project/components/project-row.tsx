"use client";

import { useState } from "react";
import Link from "next/link";
import { Film } from "lucide-react";
import type { ProjectSummary } from "@agentcut/core/common/api/client";
import { ProjectStatus } from "./project-status";
import { ProjectActions } from "./project-actions";

export function ProjectRow({ project, fallbackFocus }: { project: ProjectSummary; fallbackFocus?: React.RefObject<HTMLElement | null> }) {
  const [failedThumbnail, setFailedThumbnail] = useState<string | null>(null);
  const videos = project.sequenceCount ?? 0;

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
            <ProjectStatus status={project.status} />
          </div>
        </div>
      </Link>
      <ProjectActions project={project} fallbackFocus={fallbackFocus} />
    </li>
  );
}
