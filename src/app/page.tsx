import Link from "next/link";
import { Clapperboard, Trash2 } from "lucide-react";
import { q } from "@/lib/db";
import { NewProject } from "@/components/new-project";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

export const dynamic = "force-dynamic";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  ready: "default",
  error: "destructive",
  new: "outline",
};

export default function Home() {
  const projects = q.listProjects();

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-8 px-6 py-12">
      <header className="flex items-center gap-3">
        <Clapperboard className="size-6 shrink-0 text-primary" />
        <h1 className="text-xl font-semibold tracking-tight">agentcut</h1>
        <Badge variant="secondary" className="font-mono text-xs">
          local
        </Badge>
      </header>

      <NewProject />

      {projects.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-muted-foreground">Projects</h2>
          {projects.map((p) => (
            <Link key={p.id} href={`/p/${p.id}`}>
              <Card className="flex flex-row items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-accent/60">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{p.name}</p>
                  <p className="font-mono text-xs text-muted-foreground">{p.id}</p>
                </div>
                {p.edl ? (
                  <span className="text-xs text-muted-foreground">
                    {JSON.parse(p.edl).clips?.length ?? 0} clips
                  </span>
                ) : null}
                <Badge variant={STATUS_VARIANT[p.status] ?? "secondary"}>{p.status}</Badge>
              </Card>
            </Link>
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
