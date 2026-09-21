import { NextRequest, NextResponse } from "next/server";
import { startJob, type AnalyzeOptions } from "@/lib/jobs";

export const runtime = "nodejs";
export const maxDuration = 3600;

/** Re-recognise the source and put the new words back into every clip cut from it. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const options = (await req.json().catch(() => ({}))) as AnalyzeOptions;
  try {
    return NextResponse.json({ job: startJob(id, "transcribe", options) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 409 });
  }
}
