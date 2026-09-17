import { startJob } from "@/lib/jobs";
import { z } from "zod";
export const runtime = "nodejs";
export const maxDuration = 3600;
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const options = z.object({ instruction: z.string().trim().min(1), expectedRevision: z.number().int().nonnegative(), provider: z.string().optional(), model: z.string().optional() }).parse(await req.json());
    return Response.json({ job: startJob(id, "edit", options) });
  } catch (error) { return Response.json({ error: (error as Error).message }, { status: 409 }); }
}
