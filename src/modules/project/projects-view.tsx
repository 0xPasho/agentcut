import Link from "next/link";
import { Library, Settings, Trash2 } from "lucide-react";
import { AgentcutIcon } from "@/common/components/agentcut-mark";
import { Badge } from "@/common/ui/badge";
import { Button } from "@/common/ui/button";
import { Glass } from "@/common/ui/glass";
import type { ProjectSummary } from "@/common/api/client";
import { OnboardingReminder } from "@/modules/onboarding/components/onboarding-reminder";
import { NewProject } from "./components/new-project";
import { ProjectRow } from "./components/project-row";

/** The home page: start a project, and every project in the workspace. */
export function ProjectsView({ projects, showReminder }: { projects: ProjectSummary[]; showReminder: boolean }) {
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

      {showReminder && <OnboardingReminder />}
      <NewProject />

      {projects.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-muted-foreground">Projects</h2>
          {projects.map((project) => <ProjectRow key={project.id} project={project} />)}
        </section>
      )}

      <footer className="mt-auto flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Trash2 className="size-3" />
        Projects and media stay in your local workspace on this machine.
      </footer>
    </main>
  );
}
