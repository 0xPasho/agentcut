import { NextRequest, NextResponse } from "next/server";
import { startJob, type AnalyzeOptions } from "@/modules/project/server/jobs";

export const runtime = "nodejs";
export const maxDuration = 3600;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const options = (await req.json().catch(() => ({}))) as AnalyzeOptions;
  try {
    return NextResponse.json({ job: startJob(id, "analyze", options) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 409 });
  }
}
