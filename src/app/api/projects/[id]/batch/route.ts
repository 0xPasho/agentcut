import { NextRequest, NextResponse } from "next/server";
import { startJob } from "@/modules/project/server/jobs";
export const runtime = "nodejs";
export const maxDuration = 3600;
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { brief?: string; force?: boolean };
  try { return NextResponse.json({ job: startJob(id, "batch", { userBrief: body.brief, force: body.force }) }); }
  catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 409 }); }
}
