import { NextRequest } from "next/server";
import { q } from "@/common/server/db";
import { jobState } from "@/modules/project/lib/job-state";
import { reapDeadJobs } from "@/modules/project/server/reaper";

export const runtime = "nodejs";
export const maxDuration = 3600;

/**
 * SSE over a polled events table: survives Next's dev-mode module reloads,
 * which an in-memory emitter would not.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let lastId = Number(req.nextUrl.searchParams.get("since") ?? 0);
  // The tick runs twice a second; liveness does not change that fast.
  const REAP_EVERY_MS = 5_000;
  let lastReap = 0;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const send = (event: string, data: unknown) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      const tick = () => {
        if (closed) return;
        try {
          for (const e of q.eventsSince(id, lastId)) {
            lastId = e.id;
            send("log", { id: e.id, kind: e.kind, name: e.name, text: e.text, at: e.at, jobId: e.job_id });
          }
          // This stream is what the editor believes about the project, so it has to be
          // the thing that notices a job whose process died — otherwise a page left open
          // through a crash shows "working" until somebody reloads it.
          if (Date.now() - lastReap > REAP_EVERY_MS) { lastReap = Date.now(); reapDeadJobs(id); }
          const job = q.latestJob(id);
          const project = q.getProject(id);
          send("status", {
            revision: project?.revision ?? 0,
            status: project?.status ?? "unknown",
            error: project?.error ?? null,
            job: jobState(job),
          });
        } catch {
          // a transient read during a write shouldn't kill the stream
        }
      };

      const interval = setInterval(tick, 500);
      tick();

      req.signal.addEventListener("abort", () => {
        closed = true;
        clearInterval(interval);
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
