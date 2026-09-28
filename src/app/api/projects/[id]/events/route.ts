import { NextRequest, NextResponse } from "next/server";
import { q } from "@/common/server/db";
import { jobState } from "@/modules/project/lib/job-state";
import { reapDeadJobs } from "@/modules/project/server/reaper";

export const runtime = "nodejs";

/** What a first read returns: as much as the panel keeps, not a project's whole history. */
const BACKLOG = 400;

/**
 * The activity feed since `since`, and where the project stands now — one short answer,
 * polled. This used to be a server-sent stream, and a stream holds a connection for as
 * long as the page is open. The browser allows six per host across every tab, and a
 * `<video>` buffering the source takes some of them; with a few agentcut tabs open the
 * pool was full, and every request after that — the editor's own page load included —
 * waited for a socket that never came free. The page sat on "Rendering" forever.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const since = Number(req.nextUrl.searchParams.get("since") ?? 0) || 0;
  // This is what the editor believes about the project, so it has to be the thing that
  // notices a job whose process died — otherwise a page left open through a crash shows
  // "working" until somebody reloads it.
  reapDeadJobs(id);
  const rows = q.eventsSince(id, since);
  const events = (since ? rows : rows.slice(-BACKLOG))
    .map((e) => ({ id: e.id, kind: e.kind, name: e.name, text: e.text, at: e.at, jobId: e.job_id }));
  const project = q.getProject(id);
  return NextResponse.json({
    events,
    cursor: rows.at(-1)?.id ?? since,
    status: {
      name: project?.name ?? null,
      revision: project?.revision ?? 0,
      status: project?.status ?? "unknown",
      error: project?.error ?? null,
      job: jobState(q.latestJob(id)),
    },
  }, { headers: { "Cache-Control": "no-store" } });
}
