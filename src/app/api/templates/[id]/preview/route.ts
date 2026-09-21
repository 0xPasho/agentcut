import { NextRequest } from "next/server";
import { getTemplate } from "@/lib/templates/registry";
import { templatePreviewSvg } from "@/lib/templates/preview";
export const runtime = "nodejs";
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const svg = templatePreviewSvg(await getTemplate(id), req.nextUrl.searchParams.get("aspect") ?? "9:16");
    return new Response(svg, { headers: { "Content-Type": "image/svg+xml", "Cache-Control": "no-cache" } });
  } catch (error) { return Response.json({ error: (error as Error).message }, { status: 404 }); }
}
