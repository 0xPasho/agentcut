import { NextRequest } from "next/server";
import { readConversation } from "@/lib/editor/conversation";
export const runtime = "nodejs";
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const limit = Number(req.nextUrl.searchParams.get("limit") ?? 50);
  try { return Response.json({ messages: readConversation(id, Number.isFinite(limit) ? limit : 50) }); }
  catch (error) { return Response.json({ error: (error as Error).message }, { status: 400 }); }
}
