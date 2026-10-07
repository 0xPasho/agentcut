import { NextRequest, NextResponse } from "next/server";
import { WORKSPACE } from "@agentcut/core/common/server/config";
import { fingerprintOf, resolveLocalFile } from "@agentcut/core/modules/media/server/ingest";

export const runtime = "nodejs";

/**
 * Where on this machine a file the browser handed over already lives. A drop and a
 * file input give bytes and hide the path, but they do say the name, the size and the
 * modification time, and that is enough to find the file and clone it instead of
 * uploading it. `null` means it was not found and the caller streams the bytes.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { name?: string; size?: number; modifiedAt?: number; roots?: unknown };
  const print = fingerprintOf(body);
  if (!print) return NextResponse.json({ error: "name, size and modifiedAt are required" }, { status: 400 });
  const roots = Array.isArray(body.roots) ? body.roots.filter((root): root is string => typeof root === "string") : [];
  try {
    return NextResponse.json({ found: await resolveLocalFile(print, { roots, workspace: WORKSPACE }) });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
