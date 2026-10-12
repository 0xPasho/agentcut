import path from "node:path";
import { NextRequest } from "next/server";
import { fileResponse } from "@agentcut/core/common/server/http-file";
import { saveDir } from "@agentcut/core/modules/ideas/server/saves";
export const runtime = "nodejs";

/** A save's screenshot, video or frames. Only a bare file name, so nothing outside the save is reachable. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string; name: string }> }) {
  const { id, name } = await params;
  if (!/^[\w.-]+\.(png|jpg|webp|mp4|webm|mkv|mov)$/.test(name) || name.includes("..")) return new Response("not found", { status: 404 });
  return fileResponse(path.join(saveDir(id), name), req.headers);
}
