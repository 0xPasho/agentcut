import { notFound, redirect } from "next/navigation";
import { SequenceEditor } from "@/modules/editor/sequence-editor-view";
import { loadEditor } from "@agentcut/core/modules/project/server/pages";

export const dynamic = "force-dynamic";

export default async function EditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const initial = await loadEditor(id);
  if (!initial) notFound();
  if (initial === "no-edl") redirect(`/p/${id}`);
  return <SequenceEditor key={id} initial={initial} />;
}
