import { NextRequest } from "next/server";
import { q } from "@agentcut/core/common/server/db";
import { fileResponse } from "@agentcut/core/common/server/http-file";
import { isUrl } from "@agentcut/core/modules/project/server/ingest";

export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = q.getProject(id);
  if (!p || isUrl(p.source_path)) return new Response("not downloaded yet", { status: 404 });
  return fileResponse(p.source_path, req.headers);
}
