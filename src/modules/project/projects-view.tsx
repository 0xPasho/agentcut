import Link from "next/link";
import { HardDrive, Library, Settings } from "lucide-react";
import { AgentcutIcon } from "@/common/components/agentcut-mark";
import { Button } from "@/common/ui/button";
import type { ProjectSummary } from "@/common/api/client";
import { OnboardingReminder } from "@/modules/onboarding/components/onboarding-reminder";
import { NewProject } from "./components/new-project";
import { ProjectList } from "./components/project-list";
import { Glass } from "@/common/ui/glass";

/** The home page: start a video, or return to a project in the workspace. */
export function ProjectsView({ projects, showReminder }: { projects: ProjectSummary[]; showReminder: boolean }) {
  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-4 pt-4 sm:px-8">
      <header>
        <Glass shape="capsule" thickness="thin" className="px-3 py-2 sm:px-4">
        <nav aria-label="Workspace" className="flex min-h-10 items-center gap-3">
          <AgentcutIcon className="size-7 shrink-0" />
          <span className="text-xl font-bold tracking-[-0.04em]">agentcut</span>
          <span className="hidden border-l border-border pl-3 text-xs text-muted-foreground sm:inline">Local workspace</span>
          <Button variant="ghost" className="ml-auto" nativeButton={false} render={<Link href="/library" />}>
            <Library aria-hidden className="size-4" />Library
          </Button>
          <Button variant="ghost" size="icon" aria-label="Settings" nativeButton={false} render={<Link href="/settings" />}><Settings aria-hidden className="size-4" /></Button>
        </nav>
        </Glass>
      </header>
      <div className="flex w-full flex-col pb-8">
        {showReminder && <div className="mt-6"><OnboardingReminder /></div>}
        <section aria-label="Start a video" className="mx-auto w-full max-w-3xl py-10 sm:py-14">
          <NewProject />
        </section>
        <ProjectList projects={projects} />
        <footer className="mt-10 flex items-center gap-2 text-xs leading-relaxed text-muted-foreground">
          <HardDrive aria-hidden className="size-3.5 shrink-0" />Projects and media stay on this computer.
        </footer>
      </div>
    </main>
  );
}
