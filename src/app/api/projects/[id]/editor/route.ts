import { editorToolSchema } from "@/lib/editor/tools";
import { runReportedTool } from "@/lib/activity-log";
import { RevisionConflict } from "@/lib/editor/store";
export const runtime = "nodejs";
export async function GET() { return Response.json(editorToolSchema()); }
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // The same feed as the agent writes to: a render or a template applied from the
  // UI is progress the owner should be able to watch, whichever hand started it.
  try { return Response.json(await runReportedTool(id, await req.json(), { via: "web" })); }
  catch (error) { return Response.json({ error: (error as Error).message, ...(error instanceof RevisionConflict ? { current: error.current } : {}) }, { status: error instanceof RevisionConflict ? 409 : 400 }); }
}
