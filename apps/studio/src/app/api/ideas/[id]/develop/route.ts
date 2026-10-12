import { NextRequest } from "next/server";
import { DevelopRequest } from "@agentcut/core/modules/ideas/types";
import { developIdea, stopRuns } from "@agentcut/core/modules/ideas/server/develop";
import { getIdea } from "@agentcut/core/modules/ideas/server/store";
export const runtime = "nodejs";
type Params = { params: Promise<{ id: string }> };

/** Start one run per harness asked for. Returns once they are started, not finished. */
export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  try {
    await developIdea(id, DevelopRequest.parse(await req.json()));
    return Response.json({ idea: getIdea(id) });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}

/** Stop every run still going for this idea. */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const idea = getIdea((await params).id);
  if (!idea) return Response.json({ error: "not found" }, { status: 404 });
  stopRuns(idea);
  return Response.json({ idea: getIdea(idea.id) });
}
