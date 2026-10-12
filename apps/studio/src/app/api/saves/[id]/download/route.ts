import { NextRequest } from "next/server";
import { retryDownload } from "@agentcut/core/modules/ideas/server/service";
export const runtime = "nodejs";

/** Try to keep the save's video again. Returns at once; the download runs in the background. */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { return Response.json({ save: retryDownload((await params).id) }); }
  catch (error) { return Response.json({ error: (error as Error).message }, { status: 400 }); }
}
