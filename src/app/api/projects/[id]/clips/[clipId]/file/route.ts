import { NextRequest } from "next/server";
import { renderedClips } from "@/lib/clipFiles";
import { fileResponse } from "@/lib/httpFile";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; clipId: string }> },
) {
  const { id, clipId } = await params;
  const file = (await renderedClips(id))[clipId];
  if (!file) return new Response("not rendered", { status: 404 });
  return fileResponse(file, req.headers.get("range"));
}
