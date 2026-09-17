import { Clapperboard, Trash2 } from "lucide-react";
import { q } from "@/lib/db";
import { NewProject } from "@/components/new-project";
import { Badge } from "@/components/ui/badge";
import { ProjectRow } from "@/components/project-row";
import { Glass } from "@/components/ui/glass";

export const dynamic = "force-dynamic";

export default function Home() {
  const projects = q.listProjects();

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-8 px-6 pt-4 pb-14">
      {/* Navigation layer: glass floats above the content. */}
      <Glass
        shape="capsule"
        thickness="thick"
        className="sticky top-4 z-20 flex items-center gap-3 bg-background/80 px-5 py-3"
      >
        <Clapperboard className="size-6 shrink-0 text-primary" />
        <h1 className="text-xl font-semibold tracking-tight">agentcut</h1>
        <Badge variant="secondary" className="font-mono text-xs">
          local
        </Badge>
      </Glass>

      <NewProject />

      {projects.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-muted-foreground">Projects</h2>
          {projects.map((p) => (
            <ProjectRow
              key={p.id}
              project={{
                id: p.id,
                name: p.name,
                status: p.status,
                createdAt: p.created_at,
                clipCount: p.edl ? (JSON.parse(p.edl).clips?.length ?? 0) : 0,
              }}
            />
          ))}
        </section>
      ) : null}

      <footer className="mt-auto flex items-center gap-2 text-xs text-muted-foreground">
        <Trash2 className="size-3" />
        Everything stays in <code className="font-mono">./workspace</code> on this machine.
      </footer>
    </main>
  );
}
