import { executePublicationCommand } from "@/modules/publishing/server/tools";
import { overview } from "@/modules/publishing/server/service";
import { PublishingConflict } from "@/modules/publishing/server/store";
import { calendar } from "@/modules/publishing/server/calendar";
export const runtime = "nodejs";
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  try { return Response.json(params.has("from") ? calendar({ from: params.get("from"), to: params.get("to"), offset: Number(params.get("offset") ?? 0), projectId: params.get("projectId") ?? undefined, ...(params.has("accountId") ? { accountId: params.get("accountId") } : {}) }) : overview(params.get("projectId") ?? undefined)); }
  catch (error) { return Response.json({ error: (error as Error).message }, { status: 400 }); }
}
export async function POST(req: Request) {
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(req.url).origin) return Response.json({ error: "Cross-origin publication requests are not allowed" }, { status: 403 });
  try { return Response.json(await executePublicationCommand(await req.json(), { actor: "human" })); }
  catch (error) { return Response.json({ error: (error as Error).message, ...(error instanceof PublishingConflict ? { current: error.current } : {}) }, { status: error instanceof PublishingConflict ? 409 : 400 }); }
}
