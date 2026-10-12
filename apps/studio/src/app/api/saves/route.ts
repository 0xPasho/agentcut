import { NextRequest } from "next/server";
import { ReferenceInput } from "@agentcut/core/modules/ideas/types";
import { resumeDownloads } from "@agentcut/core/modules/ideas/server/media";
import { countSaves, listSaves } from "@agentcut/core/modules/ideas/server/saves";
import { save } from "@agentcut/core/modules/ideas/server/service";
export const runtime = "nodejs";

/** The library. `?since=<ms>` for what was kept after a moment; `&count=1` for just how many. */
export async function GET(req: NextRequest) {
  resumeDownloads();
  const since = Number(req.nextUrl.searchParams.get("since") ?? 0) || 0;
  if (req.nextUrl.searchParams.get("count")) return Response.json({ count: countSaves(since) });
  return Response.json({ saves: listSaves({ since }) });
}

/** One thing kept from the web, as the extension's toolbar sends it. */
export async function POST(req: NextRequest) {
  try { return Response.json({ save: save(ReferenceInput.parse(await req.json())) }); }
  catch (error) { return Response.json({ error: (error as Error).message }, { status: 400 }); }
}
