import fs from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { projectDir } from "@/lib/config";
import { captureAsset } from "@/lib/editor/tools";

export const runtime = "nodejs";

/**
 * Capture a still from the source into the project's assets/.
 *
 * The stream itself is the best b-roll source available: whatever is being talked
 * about is usually already on screen somewhere, it costs nothing, needs no API key,
 * and carries no licensing question.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = await req.json();
    const asset = await captureAsset(id, body.atSec, body.mediaId);
    return NextResponse.json({ name: asset.id, asset });
  } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }); }

}

/** Files already captured or dropped into assets/. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const dir = path.join(projectDir(id), "assets");
  const files = await fs.readdir(dir).catch(() => [] as string[]);
  return NextResponse.json({ assets: files.filter((f) => /\.(jpe?g|png|webp)$/i.test(f)) });
}
