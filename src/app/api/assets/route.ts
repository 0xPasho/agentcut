import { NextRequest, NextResponse } from "next/server";
import { q } from "@/common/server/db";
import { uploadLibraryAsset, ensureLibrary, scanLibrary, kindFor, removeLibraryAsset } from "@/modules/media/server/assets";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const kind = req.nextUrl.searchParams.get("kind") ?? "image";
  const projectId = req.nextUrl.searchParams.get("projectId") ?? undefined;
  // Pick up anything dropped into library/ by hand since the last look.
  await scanLibrary().catch(() => 0);
  return NextResponse.json({ assets: q.listAssets(kind, projectId) });
}

export async function POST(req: NextRequest) {
  await ensureLibrary();
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "no file" }, { status: 400 });

  const kind = kindFor(file.name);
  if (!kind) return NextResponse.json({ error: `unsupported: ${file.name}` }, { status: 400 });

  const asset = await uploadLibraryAsset(file.name, new Uint8Array(await file.arrayBuffer()));
  return NextResponse.json({ asset });
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  try {
    await removeLibraryAsset(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 409 });
  }
}
