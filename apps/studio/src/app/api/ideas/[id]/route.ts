import { NextRequest } from "next/server";
import { IdeaPatch } from "@agentcut/core/modules/ideas/types";
import { stopRuns } from "@agentcut/core/modules/ideas/server/develop";
import { deleteIdea, getIdea, updateIdea } from "@agentcut/core/modules/ideas/server/store";
export const runtime = "nodejs";
type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const idea = getIdea((await params).id);
  return idea ? Response.json({ idea }) : Response.json({ error: "not found" }, { status: 404 });
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try { return Response.json({ idea: updateIdea((await params).id, IdeaPatch.parse(await req.json())) }); }
  catch (error) { return Response.json({ error: (error as Error).message }, { status: 400 }); }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const idea = getIdea(id);
  if (!idea) return Response.json({ error: "not found" }, { status: 404 });
  stopRuns(idea);
  deleteIdea(id);
  return Response.json({ ok: true });
}
