import { notFound } from "next/navigation";
import { q } from "@/lib/db";
import { readEditor } from "@/lib/editor/store";
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

  // The shared reader repairs word timings saved before cutting clamped them; parsing the
  // row directly hands the browser a state that fails validation on its very first edit.
  const { edl, revision } = readEditor(id);
  const clip = edl.clips.find((c) => c.id === clipId);
  const timeline = edl.sequences.find((sequence) => sequence.id === clipId);
  if (!clip && !timeline) notFound();

  return <ClipEditor key={`${id}:${clipId}`} projectId={id} projectName={project.name} edl={edl} revision={revision} clipId={clipId} />;
}
