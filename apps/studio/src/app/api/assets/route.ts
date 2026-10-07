import { NextRequest, NextResponse } from "next/server";
import { q } from "@agentcut/core/common/server/db";
import { saveUploadedAsset, importLocalLibraryAsset, ensureLibrary, scanLibrary, kindFor, removeLibraryAsset } from "@agentcut/core/modules/media/server/assets";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const kind = req.nextUrl.searchParams.get("kind") ?? "image";
  const projectId = req.nextUrl.searchParams.get("projectId") ?? undefined;
  // Pick up anything dropped into library/ by hand since the last look.
  await scanLibrary().catch(() => 0);
  return NextResponse.json({ assets: q.listAssets(kind, projectId) });
}

/**
 * An asset from the browser. A file on this machine comes as JSON `{ file }` and is
 * cloned into the library; bytes the browser could not name come as the raw body under
 * `x-file-name`, streamed to disk. With `projectId` (a query parameter) the asset is
 * that project's rather than the library's. The multipart form is kept for callers
 * that already speak it.
 */
export async function POST(req: NextRequest) {
  await ensureLibrary();
  const projectId = req.nextUrl.searchParams.get("projectId") ?? undefined;
  try {
    if ((req.headers.get("content-type") ?? "").includes("application/json")) {
      const { file } = (await req.json()) as { file?: string };
      if (typeof file !== "string" || !file.trim()) return NextResponse.json({ error: "no file" }, { status: 400 });
      if (projectId) {
        const { importLocalAsset } = await import("@agentcut/core/modules/media/server/local-assets");
        return NextResponse.json({ asset: await importLocalAsset(projectId, file) });
      }
      return NextResponse.json({ asset: await importLocalLibraryAsset(file) });
    }
    const uploadName = req.headers.get("x-file-name");
    if (uploadName) {
      const name = decodeURIComponent(uploadName);
      if (!kindFor(name)) return NextResponse.json({ error: `unsupported: ${name}` }, { status: 400 });
      if (!req.body) return NextResponse.json({ error: "no file" }, { status: 400 });
      return NextResponse.json({ asset: await saveUploadedAsset(name, req.body, { projectId }) });
    }
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "no file" }, { status: 400 });
    if (!kindFor(file.name)) return NextResponse.json({ error: `unsupported: ${file.name}` }, { status: 400 });
    return NextResponse.json({ asset: await saveUploadedAsset(file.name, file.stream(), { projectId }) });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
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
