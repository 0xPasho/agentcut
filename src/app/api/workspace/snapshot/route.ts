import { downloadSnapshot, snapshotRequest, uploadSnapshot } from "@/modules/settings/server/snapshot-http";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try { return await downloadSnapshot(new URL(request.url).searchParams.get("id") ?? ""); }
  catch { return Response.json({ error: "Snapshot not found" }, { status: 404 }); }
}

export async function POST(request: Request) {
  try {
    if (new URL(request.url).searchParams.get("action") === "upload") return Response.json(await uploadSnapshot(request));
    return Response.json(await snapshotRequest(await request.json()));
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
}
