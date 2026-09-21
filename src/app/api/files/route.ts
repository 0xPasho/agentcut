import { NextRequest, NextResponse } from "next/server";
import { browseLocalFolder } from "@/lib/editor/local-assets";

export const runtime = "nodejs";

/**
 * This machine's folders, before a project exists. It is the same listing the editor's
 * media browser and the agent's `assets.browseLocal` read, so choosing a file on the home
 * screen and choosing one inside the editor see the same disk.
 */
export async function GET(req: NextRequest) {
  const folder = req.nextUrl.searchParams.get("folder")?.trim();
  const offset = Math.max(0, Number(req.nextUrl.searchParams.get("offset") ?? 0) || 0);
  try {
    return NextResponse.json(await browseLocalFolder(folder || undefined, offset));
  } catch (e) {
    return NextResponse.json({ error: `That folder could not be opened: ${(e as Error).message}` }, { status: 400 });
  }
}
