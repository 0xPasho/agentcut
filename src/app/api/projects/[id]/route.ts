import { NextRequest, NextResponse } from "next/server";
import { q } from "@/common/server/db";
import { editProject, RevisionConflict } from "@/modules/editor/server/store";
import { loadProjectDetail } from "@/modules/project/server/pages";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  // The editor polls this; reaping here is what makes a project stuck behind a job
  // from a dead process heal itself without anybody having to know why.
  const project = await loadProjectDetail(id);
  if (!project) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(project);
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  q.deleteProject(id);
  return NextResponse.json({ ok: true });
}

/** Both UI and agent submit the same revision-checked operations. */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  try {
    // The web editor is a person; agents come through the tools and MCP.
    return NextResponse.json(editProject(id, await req.json(), { actor: "human" }));
  } catch (error) {
    if (error instanceof RevisionConflict) return NextResponse.json({ error: error.message, current: error.current }, { status: 409 });
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
