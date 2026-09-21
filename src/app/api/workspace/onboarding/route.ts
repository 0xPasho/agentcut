import { runOnboarding } from "@/lib/onboarding";
import { effectiveSelection } from "@/lib/agent/selection";

export const runtime = "nodejs";
export const maxDuration = 600;

/**
 * The interview's one slow step: an agent reads the answers and writes the
 * preferences. That takes tens of seconds, and the full-screen flow has nothing
 * else to show meanwhile, so the run is streamed as newline-delimited JSON —
 * `{ kind, text }` per agent event, then one `{ done }` or `{ error }`.
 *
 * `POST /api/workspace` with `onboarding.run` still works and still returns the
 * same result in one piece; this route is the same call with its progress visible.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { answers?: unknown };
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (payload: unknown) => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(JSON.stringify(payload) + "\n")); } catch { closed = true; }
      };
      try {
        const result = await runOnboarding(body.answers ?? {}, {
          ...effectiveSelection(undefined),
          onEvent: (e) => { if (e.kind !== "error") send({ kind: e.kind, name: e.name, text: e.text.slice(0, 400) }); },
        });
        send({ done: result });
      } catch (error) {
        send({ error: (error as Error).message });
      } finally {
        closed = true;
        try { controller.close(); } catch { /* already closed */ }
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-cache, no-transform" },
  });
}
