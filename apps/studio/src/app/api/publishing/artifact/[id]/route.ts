import { artifactFile } from "@agentcut/core/modules/publishing/server/artifacts";
import { artifact } from "@agentcut/core/modules/publishing/server/store";
import { fileResponse } from "@agentcut/core/common/server/http-file";
export const runtime = "nodejs";
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try { const { id } = await params; artifact(id); return await fileResponse(artifactFile(id), req.headers); }
  catch { return new Response("Export not found", { status: 404 }); }
}
