import { NextRequest } from "next/server";
import { CaptureRequest } from "@agentcut/core/modules/ideas/types";
import { capture } from "@agentcut/core/modules/ideas/server/service";
import { listIdeas } from "@agentcut/core/modules/ideas/server/store";
export const runtime = "nodejs";

/** The board, and everything the extension lists under "add to an idea". */
export async function GET() {
  try { return Response.json({ ideas: listIdeas() }); }
  catch (error) { return Response.json({ error: (error as Error).message }, { status: 500 }); }
}

/** A capture from the extension or the board: a new idea, or more for `ideaId`, optionally developed at once. */
export async function POST(req: NextRequest) {
  try { return Response.json({ idea: await capture(CaptureRequest.parse(await req.json())) }); }
  catch (error) { return Response.json({ error: (error as Error).message }, { status: 400 }); }
}
