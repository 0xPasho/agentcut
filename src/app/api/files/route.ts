import os from "node:os";
import { NextRequest, NextResponse } from "next/server";
import { browseLocalFolder, places } from "@/modules/media/server/local-assets";

export const runtime = "nodejs";

/**
 * This machine's folders, before a project exists. It is the same listing the editor's
 * media browser and the agent's `assets.browseLocal` read, so choosing a file on the home
 * screen and choosing one inside the editor see the same disk.
 */
export async function GET(req: NextRequest) {
  const folder = req.nextUrl.searchParams.get("folder")?.trim();
  const offset = Math.max(0, Number(req.nextUrl.searchParams.get("offset") ?? 0) || 0);
  const limit = Math.min(5000, Math.max(1, Number(req.nextUrl.searchParams.get("limit") ?? 100) || 100));
  try {
    const [listing, shortcuts] = await Promise.all([browseLocalFolder(folder || undefined, offset, limit), places()]);
    return NextResponse.json({ ...listing, home: os.homedir(), places: shortcuts });
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "EPERM" || code === "EACCES") {
      return NextResponse.json({
        error: `macOS is blocking this folder. Open System Settings › Privacy & Security › Files and Folders and allow the app running the server — your terminal or editor — to read it, then try again. Full Disk Access covers every folder at once.`,
      }, { status: 403 });
    }
    return NextResponse.json({ error: `That folder could not be opened: ${(e as Error).message}` }, { status: 400 });
  }
}
