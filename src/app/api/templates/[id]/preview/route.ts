import { NextRequest } from "next/server";
import { getTemplate } from "@/modules/templates/server/registry";
import { templatePreviewSvg } from "@/modules/templates/lib/preview";
import { aspectOf } from "@/modules/templates/lib/resolve";
import { readEditor } from "@/modules/editor/server/store";
export const runtime = "nodejs";

/**
 * The schematic of a template, in the shape of the video it is being considered for.
 * A template's variants exist precisely so a square copy is framed differently, and a
 * panel showing the 9:16 schematic beside a 1:1 video is showing the wrong one.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const search = req.nextUrl.searchParams;
  try {
    let aspect = search.get("aspect") ?? "9:16";
    const project = search.get("project");
    const sequenceId = search.get("sequence");
    if (project && sequenceId) {
      const sequence = readEditor(project).edl.sequences.find((s) => s.id === sequenceId);
      if (sequence) aspect = aspectOf(sequence.output);
    }
    const svg = templatePreviewSvg(await getTemplate(id), aspect);
    return new Response(svg, { headers: { "Content-Type": "image/svg+xml", "Cache-Control": "no-cache" } });
  } catch (error) { return Response.json({ error: (error as Error).message }, { status: 404 }); }
}
