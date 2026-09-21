import { notFound, redirect } from "next/navigation";
import { q } from "@/lib/db";
import { readEditor } from "@/lib/editor/store";
import { renderedClips } from "@/lib/clipFiles";
import { SequenceEditor } from "@/components/sequence-editor";
import { jobState } from "@/lib/client";
import { reapDeadJobs } from "@/lib/reaper";
export const dynamic = "force-dynamic";
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  reapDeadJobs(id);
  const p = q.getProject(id);
  if (!p) notFound();
  if (!p.edl) redirect(`/p/${id}`);
  const snapshot = readEditor(id);
  return <SequenceEditor key={id} initial={{ id, name: p.name, sourcePath: p.source_path, status: p.status, error: p.error, probe: p.probe ? JSON.parse(p.probe) : null, ...snapshot, rendered: Object.keys(await renderedClips(id)), job: jobState(q.latestJob(id)) }} />;
}
