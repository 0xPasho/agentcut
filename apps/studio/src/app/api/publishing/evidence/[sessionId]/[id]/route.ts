import { evidenceFile } from "@agentcut/core/modules/publishing/server/phone/sessions";
import { fileResponse } from "@agentcut/core/common/server/http-file";
export const runtime = "nodejs";
export async function GET(req: Request, { params }: { params: Promise<{ sessionId: string; id: string }> }) {
  try { const { sessionId, id } = await params; const response = await fileResponse(evidenceFile(sessionId, id), req.headers); response.headers.set("Cache-Control", "private, no-store"); return response; }
  catch { return new Response("Evidence not found", { status: 404 }); }
}
