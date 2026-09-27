import { artifactFile } from "@/modules/publishing/server/artifacts";
import { artifact } from "@/modules/publishing/server/store";
import { fileResponse } from "@/common/server/http-file";
export const runtime = "nodejs";
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try { const { id } = await params; artifact(id); return await fileResponse(artifactFile(id), req.headers); }
  catch { return new Response("Export not found", { status: 404 }); }
}
