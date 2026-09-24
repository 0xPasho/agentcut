"use client";

import { useId, useState } from "react";
import { Search, Video } from "lucide-react";
import type { ProjectSummary } from "@/common/api/client";
import { Button } from "@/common/ui/button";
import { Input } from "@/common/ui/input";
import { ProjectRow } from "./project-row";

export function ProjectList({ projects }: { projects: ProjectSummary[] }) {
  const id = useId();
  const [query, setQuery] = useState("");
  const shown = projects.filter(project => project.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));

  return (
    <section aria-labelledby={`${id}-heading`}>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 id={`${id}-heading`} className="flex items-center gap-2 text-base font-semibold">Projects <span className="text-xs font-normal tabular-nums text-muted-foreground">{projects.length}</span></h2>
          <p className="mt-1 text-sm text-muted-foreground">Pick up where you left off.</p>
        </div>
        {projects.length > 0 && (
          <div className="w-full sm:w-60">
            <label htmlFor={`${id}-search`} className="sr-only">Search projects</label>
            <div className="relative">
              <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input id={`${id}-search`} type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search projects" className="pl-9" />
            </div>
          </div>
        )}
      </div>
      {shown.length > 0 && (
        <ul aria-label="Projects" className="divide-y divide-border/50 border-y border-border/70">
          {shown.map(project => <ProjectRow key={project.id} project={project} />)}
        </ul>
      )}
      {projects.length > 0 && shown.length === 0 && (
        <div role="status" className="border-y border-border/60 py-10 text-center">
          <p className="break-words text-sm text-muted-foreground">No projects match “{query}”.</p>
          <Button variant="ghost" className="mt-2" onClick={() => setQuery("")}>Clear search</Button>
        </div>
      )}
      {projects.length === 0 && (
        <div className="flex items-center gap-4 border-y border-border/60 py-8">
          <Video aria-hidden className="size-6 shrink-0 text-muted-foreground" />
          <div><p className="text-sm font-medium">Your first video starts above</p><p className="mt-1 text-sm text-muted-foreground">Describe an idea or add footage. Your projects will appear here.</p></div>
        </div>
      )}
      <p role="status" className="sr-only">{query && `${shown.length} projects found`}</p>
    </section>
  );
}
