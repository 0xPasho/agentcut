import { NextRequest, NextResponse } from "next/server";
import { importProjectMedia } from "@/lib/editor/media";
import { RevisionConflict } from "@/lib/editor/store";
export const runtime = "nodejs";
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("Choose a video file");
    return NextResponse.json(await importProjectMedia(id, Number(form.get("expectedRevision")), { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }));
  } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: e instanceof RevisionConflict ? 409 : 400 }); }
}
