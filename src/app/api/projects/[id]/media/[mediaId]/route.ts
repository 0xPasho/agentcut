import { NextRequest } from "next/server";
import { mediaFile } from "@/modules/editor/server/store";
import { fileResponse } from "@/common/server/http-file";
export const runtime = "nodejs";
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string; mediaId: string }> }) {
  const { id, mediaId } = await params;
  const file = mediaFile(id, mediaId);
  return file ? fileResponse(file, req.headers) : new Response("Media not found", { status: 404 });
}
