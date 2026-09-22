import path from "node:path";
import { NextRequest } from "next/server";
import { projectDir } from "@/common/server/config";
import { fileResponse } from "@/common/server/http-file";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; name: string }> },
) {
  const { id, name } = await params;
  const dir = path.join(projectDir(id), "assets");
  const file = path.resolve(dir, name);
  // Never let a name escape the project's own assets directory.
  if (!file.startsWith(dir)) return new Response("forbidden", { status: 403 });
  return fileResponse(file, req.headers);
}
