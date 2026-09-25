import { NextRequest } from "next/server";
import { q } from "@/common/server/db";
import { toAbs } from "@/modules/media/server/assets";
import { fileResponse } from "@/common/server/http-file";

export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = q.getAsset(id);
  if (!row) return new Response("not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  const res = await fileResponse(toAbs(row.path), req.headers);
  // An asset id names its bytes, so a picture that was served can be kept for good. A
  // miss cannot: marked immutable, one moment with the file away kept the preview on a
  // 404 after the file was back, while the export — which asks again — showed it.
  res.headers.set("Cache-Control", res.ok ? "public, max-age=31536000, immutable" : "no-store");
  return res;
}
