import { NextRequest } from "next/server";
import { fileResponse } from "@/common/server/http-file";
import { packExampleFile } from "@/modules/packs/server/style";

export const runtime = "nodejs";

/** A reference's still or file, for the pack editor to show. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const file = packExampleFile(id, req.nextUrl.searchParams.get("path") ?? "");
  if (!file) return new Response("not found", { status: 404 });
  try {
    return await fileResponse(file, req.headers);
  } catch {
    return new Response("not found", { status: 404 });
  }
}
