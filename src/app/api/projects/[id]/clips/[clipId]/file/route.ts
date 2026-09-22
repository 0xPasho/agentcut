import { NextRequest } from "next/server";
import { renderedClips } from "@/modules/project/server/clip-files";
import { fileResponse } from "@/common/server/http-file";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; clipId: string }> },
) {
  const { id, clipId } = await params;
  const file = (await renderedClips(id))[clipId];
  if (!file) return new Response("not rendered", { status: 404 });
  return fileResponse(file, req.headers);
}
