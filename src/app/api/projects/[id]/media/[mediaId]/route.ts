import { NextRequest } from "next/server";
import { readEditor } from "@/lib/editor/store";
import { fileResponse } from "@/lib/httpFile";
export const runtime = "nodejs";
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string; mediaId: string }> }) {
  const { id, mediaId } = await params;
  try {
    const media = readEditor(id).edl.media.find(m => m.id === mediaId);
    return media ? fileResponse(media.file, req.headers.get("range")) : new Response("Media not found", { status: 404 });
  } catch { return new Response("Project not found", { status: 404 }); }
}
