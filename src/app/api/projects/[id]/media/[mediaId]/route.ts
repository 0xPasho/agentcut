import { NextRequest } from "next/server";
import { mediaFile } from "@/lib/editor/store";
import { fileResponse } from "@/lib/httpFile";
export const runtime = "nodejs";
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string; mediaId: string }> }) {
  const { id, mediaId } = await params;
  const file = mediaFile(id, mediaId);
  return file ? fileResponse(file, req.headers) : new Response("Media not found", { status: 404 });
}
