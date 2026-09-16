import { notFound } from "next/navigation";
import { q } from "@/lib/db";
import { Edl } from "@/lib/edl";
import { ClipEditor } from "@/components/clip-editor";

export const dynamic = "force-dynamic";

export default async function ClipEditorPage({
  params,
}: {
  params: Promise<{ id: string; clipId: string }>;
}) {
  const { id, clipId } = await params;
  const project = q.getProject(id);
  if (!project?.edl) notFound();

  const edl = Edl.parse(JSON.parse(project.edl));
  const clip = edl.clips.find((c) => c.id === clipId);
  if (!clip) notFound();

  return <ClipEditor projectId={id} projectName={project.name} edl={edl} clipId={clipId} />;
}
