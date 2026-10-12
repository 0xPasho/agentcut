import { NextRequest } from "next/server";
import { SavePatch } from "@agentcut/core/modules/ideas/types";
import { deleteSave, getSave, updateSave } from "@agentcut/core/modules/ideas/server/saves";
export const runtime = "nodejs";
type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const found = getSave((await params).id);
  return found ? Response.json({ save: found }) : Response.json({ error: "not found" }, { status: 404 });
}

/** A note for a save: replaced, or added to (what was said a moment after saving). */
export async function PATCH(req: NextRequest, { params }: Params) {
  try { return Response.json({ save: updateSave((await params).id, SavePatch.parse(await req.json())) }); }
  catch (error) { return Response.json({ error: (error as Error).message }, { status: 400 }); }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  deleteSave((await params).id);
  return Response.json({ ok: true });
}
