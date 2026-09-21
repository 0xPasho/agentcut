import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { NextRequest, NextResponse } from "next/server";
import { browseLocalFolder, type Place } from "@/lib/editor/local-assets";

export const runtime = "nodejs";

/**
 * Desktop, Documents and Downloads are protected by macOS, and the process running this
 * server is not the Finder: it is whatever terminal or editor started `next dev`. Opening
 * the directory handle — without reading a single name out of it — says which of the three
 * answers applies, cheaply enough to do on every listing.
 */
async function reach(folder: string): Promise<"ok" | "blocked" | "missing"> {
  try {
    const dir = await fs.opendir(folder);
    await dir.close();
    return "ok";
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    return code === "EPERM" || code === "EACCES" ? "blocked" : "missing";
  }
}

/** The shortcuts a file browser is expected to open with, minus the ones this Mac lacks. */
async function places(): Promise<Place[]> {
  const home = os.homedir();
  const candidates = [
    { name: path.basename(home), path: home },
    { name: "Desktop", path: path.join(home, "Desktop") },
    { name: "Documents", path: path.join(home, "Documents") },
    { name: "Downloads", path: path.join(home, "Downloads") },
    { name: "Movies", path: path.join(home, "Movies") },
    { name: "Pictures", path: path.join(home, "Pictures") },
    { name: "Music", path: path.join(home, "Music") },
    { name: "Projects", path: path.join(home, "Projects") },
  ];
  const state = await Promise.all(candidates.map(place => reach(place.path)));
  return candidates
    .map((place, i) => ({ ...place, blocked: state[i] === "blocked" }))
    .filter((_, i) => state[i] !== "missing");
}

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
