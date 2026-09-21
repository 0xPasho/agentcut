import { notFound } from "next/navigation";
import { q } from "@/lib/db";
import { renderedClips } from "@/lib/clipFiles";
import { readEditor } from "@/lib/editor/store";
import { ProjectView } from "@/components/project-view";
import { jobState, type ProjectDetail } from "@/lib/client";
import { reapDeadJobs } from "@/lib/reaper";

export const dynamic = "force-dynamic";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  reapDeadJobs(id);
  const p = q.getProject(id);
  if (!p) notFound();

  const initial: ProjectDetail = {
    id: p.id,
    name: p.name,
    status: p.status,
    error: p.error,
    sourcePath: p.source_path,
    probe: p.probe ? JSON.parse(p.probe) : null,
    revision: p.revision,
    edl: p.edl ? readEditor(id).edl : null,
    rendered: Object.keys(await renderedClips(id)),
    job: jobState(q.latestJob(id)),
  };

  return <ProjectView key={id} initial={initial} />;
}
