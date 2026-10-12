import { NextRequest } from "next/server";
import { getSave } from "@agentcut/core/modules/ideas/server/saves";
import { cachedTranscript, transcriptFor } from "@agentcut/core/modules/ideas/server/study";
export const runtime = "nodejs";
export const maxDuration = 300;
type Params = { params: Promise<{ id: string }> };

/** What is said in the saved video, if it has been recognised already; `null` if not. */
export async function GET(_req: NextRequest, { params }: Params) {
  const save = getSave((await params).id);
  if (!save) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json({ transcript: await cachedTranscript(save) });
}

/** Recognise it now, on this computer, and keep it for every later read. */
export async function POST(_req: NextRequest, { params }: Params) {
  const save = getSave((await params).id);
  if (!save) return Response.json({ error: "not found" }, { status: 404 });
  try { return Response.json({ transcript: await transcriptFor(save) }); }
  catch (error) { return Response.json({ error: (error as Error).message }, { status: 400 }); }
}
