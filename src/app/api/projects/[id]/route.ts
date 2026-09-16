import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";
import { renderedClips } from "@/lib/clipFiles";
import { Edl } from "@/lib/edl";

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
    edl: p.edl ? JSON.parse(p.edl) : null,
    rendered: Object.keys(rendered),
    job: q.latestJob(id) ?? null,
  });
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  q.deleteProject(id);
  return NextResponse.json({ ok: true });
}

/** Persist clip edits made in the UI (caption style, edit track, trim). */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const p = q.getProject(id);
  if (!p?.edl) return NextResponse.json({ error: "no EDL" }, { status: 404 });

  const body = (await req.json()) as { edl?: unknown };
  const parsed = Edl.safeParse(body.edl);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "invalid EDL" }, { status: 400 });
  }

  q.setProject(id, { edl: JSON.stringify(parsed.data) });
  return NextResponse.json({ ok: true });
}
