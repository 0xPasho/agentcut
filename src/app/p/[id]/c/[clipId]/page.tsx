import { notFound } from "next/navigation";
import { ClipEditor } from "@/modules/editor/clip-editor-view";
import { loadClipEditor } from "@/modules/project/server/pages";

export const dynamic = "force-dynamic";

export default async function ClipEditorPage({ params }: { params: Promise<{ id: string; clipId: string }> }) {
  const { id, clipId } = await params;
  const props = loadClipEditor(id, clipId);
  if (!props) notFound();
  return <ClipEditor key={`${id}:${clipId}`} {...props} />;
}
