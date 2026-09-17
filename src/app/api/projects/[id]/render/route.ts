import { NextRequest, NextResponse } from "next/server";
import { startJob } from "@/lib/jobs";

export const runtime = "nodejs";
export const maxDuration = 3600;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { only?: string[]; expectedRevision?: number };
  try {
    return NextResponse.json({ job: startJob(id, "render", { only: body.only, expectedRevision: body.expectedRevision }) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 409 });
  }
}
