import { NextRequest } from "next/server";
import { q } from "@/lib/db";
import { toAbs } from "@/lib/assets";
import { fileResponse } from "@/lib/httpFile";

export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = q.getAsset(id);
  if (!row) return new Response("not found", { status: 404 });
  const res = await fileResponse(toAbs(row.path), req.headers);
  res.headers.set("Cache-Control", "public, max-age=31536000, immutable");
  return res;
}
