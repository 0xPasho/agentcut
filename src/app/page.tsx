import Link from "next/link";
import { redirect } from "next/navigation";
import { Library, Settings, Trash2 } from "lucide-react";
import { AgentcutIcon } from "@/components/agentcut-mark";
import { Button } from "@/components/ui/button";
import { q } from "@/lib/db";
import { NewProject } from "@/components/new-project";
import { Badge } from "@/components/ui/badge";
import { ProjectRow } from "@/components/project-row";
import { Glass } from "@/components/ui/glass";
import { OnboardingReminder } from "@/components/onboarding-reminder";
import { onboardingState } from "@/lib/onboarding";

export const dynamic = "force-dynamic";

export default async function Home() {
  const projects = q.listProjects();
  const onboarding = await onboardingState();

  // First run goes to the interview, once. Skipping or finishing it lands back
  // here for good; a deep link to any other page is never redirected.
  if (onboarding.status === "pending" && !onboarding.hasPreferences) redirect("/welcome");

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-8 px-4 sm:px-6 pt-4 pb-14">
      {/* Navigation layer: glass floats above the content. */}
      <Glass
        shape="capsule"
        thickness="thick"
        className="sticky top-4 z-20 flex items-center gap-2 px-3 py-3 sm:gap-3 sm:px-5"
      >
        <AgentcutIcon className="size-7 shrink-0" />
        <h1 className="text-xl font-bold tracking-[-0.04em]">agentcut</h1>
        {/* Two entries now sit to the right of it; at 320px the row no longer fits with
            the badge in it, and "local" is the one thing here that is decoration. */}
        <Badge variant="secondary" className="hidden font-mono text-xs sm:inline-flex">
          local
        </Badge>
        <Button variant="ghost" size="sm" className="ml-auto" nativeButton={false} render={<Link href="/library" />}>
          <Library className="size-4" />
          Library
        </Button>
        <Button variant="ghost" size="icon" aria-label="Settings" nativeButton={false} render={<Link href="/settings" />}><Settings className="size-4" /></Button>
      </Glass>

      {!onboarding.hasPreferences && onboarding.reminder && <OnboardingReminder />}
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
                sequenceCount: p.edl ? (JSON.parse(p.edl).sequences?.length ?? 0) : 0,
                clipCount: p.edl ? (JSON.parse(p.edl).clips?.length ?? 0) : 0,
              }}
            />
          ))}
        </section>
      ) : null}

      <footer className="mt-auto flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Trash2 className="size-3" />
        Projects and media stay in your local workspace on this machine.
      </footer>
    </main>
  );
}
