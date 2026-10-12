import { NextRequest } from "next/server";
import { removeSaveFromIdea } from "@agentcut/core/modules/ideas/server/store";
export const runtime = "nodejs";

/** Take a save out of an idea. The save stays in the library. */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; saveId: string }> }) {
  const { id, saveId } = await params;
  try { return Response.json({ idea: removeSaveFromIdea(id, saveId) }); }
  catch (error) { return Response.json({ error: (error as Error).message }, { status: 400 }); }
}
