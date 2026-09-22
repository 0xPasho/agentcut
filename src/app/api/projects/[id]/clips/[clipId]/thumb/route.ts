import { NextRequest } from "next/server";
import { q } from "@/common/server/db";
import { Edl } from "@/modules/editor/types";
import { clipThumb, thumbTarget } from "@/modules/project/server/thumbs";
import { fileResponse } from "@/common/server/http-file";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; clipId: string }> },
) {
  const { id, clipId } = await params;
  const project = q.getProject(id);
  if (!project?.edl) return new Response("no EDL", { status: 404 });

  const edl = Edl.parse(JSON.parse(project.edl));
  // A generated clip and the timeline it promotes into share an id, so one poster
  // route serves both and the overview keeps its picture across that handoff.
  const target = thumbTarget(edl, clipId);
  if (!target) return new Response("no footage to take a poster from", { status: 404 });

  try {
    const file = await clipThumb(id, target.source, target.clip, target.output);
    const res = await fileResponse(file, req.headers);
    res.headers.set("Cache-Control", "public, max-age=31536000, immutable");
    return res;
  } catch (e) {
    return new Response((e as Error).message, { status: 500 });
  }
}
