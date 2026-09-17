import { NextRequest } from "next/server";
import { q } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 3600;

/**
 * SSE over a polled events table: survives Next's dev-mode module reloads,
 * which an in-memory emitter would not.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let lastId = Number(req.nextUrl.searchParams.get("since") ?? 0);
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
            send("log", { id: e.id, kind: e.kind, name: e.name, text: e.text, at: e.at });
          }
          const job = q.latestJob(id);
          const project = q.getProject(id);
          send("status", {
            revision: project?.revision ?? 0,
            status: project?.status ?? "unknown",
            error: project?.error ?? null,
            job: job ? { id: job.id, kind: job.kind, status: job.status, stage: job.stage, progress: job.progress } : null,
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
