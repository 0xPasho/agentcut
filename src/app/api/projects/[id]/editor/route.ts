import { executeEditorTool, editorToolSchema } from "@/lib/editor/tools";
import { RevisionConflict } from "@/lib/editor/store";
export const runtime = "nodejs";
export async function GET() { return Response.json(editorToolSchema()); }
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try { return Response.json(await executeEditorTool(id, await req.json())); }
  catch (error) { return Response.json({ error: (error as Error).message, ...(error instanceof RevisionConflict ? { current: error.current } : {}) }, { status: error instanceof RevisionConflict ? 409 : 400 }); }
}
