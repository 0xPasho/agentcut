import { redirect } from "next/navigation";
import { ProjectsView } from "@/modules/project/projects-view";
import { loadHome } from "@/modules/project/server/pages";

export const dynamic = "force-dynamic";

export default async function Home() {
  const { projects, onboarding } = await loadHome();
  // First run goes to the interview, once. Skipping or finishing it lands back
  // here for good; a deep link to any other page is never redirected.
  if (onboarding.status === "pending" && !onboarding.hasPreferences) redirect("/welcome");
  return <ProjectsView projects={projects} showReminder={!onboarding.hasPreferences && onboarding.reminder} />;
}
