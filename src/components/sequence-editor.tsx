"use client";
import { useSearchParams } from "next/navigation";
import type { ProjectDetail } from "@/lib/client";
import { ClipEditor } from "./clip-editor";
/** Both entry flows mount the same editor. This adapter only selects a timeline. */
export function SequenceEditor({ initial }: { initial: ProjectDetail }) {
  const params = useSearchParams();
  return <ClipEditor projectId={initial.id} projectName={initial.name} edl={initial.edl!} revision={initial.revision} sequenceId={params.get("sequence") ?? initial.edl?.sequences[0]?.id} />;
}
