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
  const timeline = edl.sequences.find((sequence) => sequence.id === clipId);
  if (!clip && !timeline) notFound();

  return <ClipEditor key={`${id}:${clipId}`} projectId={id} projectName={project.name} edl={edl} revision={project.revision} clipId={clipId} />;
}
