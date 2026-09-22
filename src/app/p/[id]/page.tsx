import { notFound } from "next/navigation";
import { ProjectView } from "@/modules/project/project-view";
import { loadProjectDetail } from "@/modules/project/server/pages";

export const dynamic = "force-dynamic";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const initial = await loadProjectDetail(id);
  if (!initial) notFound();
  return <ProjectView key={id} initial={initial} />;
}
