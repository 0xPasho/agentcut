import { NextResponse } from "next/server";
import { q } from "@/common/server/db";
import { reapDeadJobs, unlockProject } from "@/modules/project/server/reaper";

export const runtime = "nodejs";

/**
 * Give the project back when a job is stuck. A dead owner is reaped first, so the
 * forceful path only ever runs against a job that is genuinely still alive.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!q.getProject(id)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const reaped = reapDeadJobs(id);
  const stopped = unlockProject(id);
  return NextResponse.json({ reaped: reaped.map((j) => j.id), stopped: stopped?.id ?? null });
}
