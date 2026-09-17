import fs from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";
import { LIBRARY, ensureLibrary, registerAsset, scanLibrary, kindFor } from "@/lib/assets";

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

  const dest = path.join(LIBRARY, kind === "audio" ? "audio" : "images", file.name);
  await fs.writeFile(dest, Buffer.from(await file.arrayBuffer()));

  const asset = await registerAsset({
    file: dest,
    kind,
    scope: "library",
    name: file.name,
    source: "upload",
  });
  return NextResponse.json({ asset });
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  q.deleteAsset(id);
  return NextResponse.json({ ok: true });
}
