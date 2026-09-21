import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";
import { renderedClips } from "@/lib/clipFiles";
import { editProject, readEditor, RevisionConflict } from "@/lib/editor/store";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const p = q.getProject(id);
  if (!p) return NextResponse.json({ error: "not found" }, { status: 404 });

  const rendered = await renderedClips(id);
  return NextResponse.json({
    id: p.id,
    name: p.name,
    status: p.status,
    error: p.error,
    sourcePath: p.source_path,
    probe: p.probe ? JSON.parse(p.probe) : null,
    revision: p.revision,
    edl: p.edl ? readEditor(id).edl : null,
    rendered: Object.keys(rendered),
    job: q.latestJob(id) ?? null,
  });
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
