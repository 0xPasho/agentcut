import fs from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { projectDir } from "@/lib/config";
import { q } from "@/lib/db";
import { grabFrame } from "@/lib/media";

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
  const project = q.getProject(id);
  if (!project) return NextResponse.json({ error: "no project" }, { status: 404 });

  const body = (await req.json()) as { atSec?: number };
  const at = Number(body.atSec);
  if (!Number.isFinite(at) || at < 0) {
    return NextResponse.json({ error: "atSec required" }, { status: 400 });
  }

  const dir = path.join(projectDir(id), "assets");
  await fs.mkdir(dir, { recursive: true });
  const name = `frame-${Math.round(at * 100)}.jpg`;

  try {
    await grabFrame(project.source_path, at, path.join(dir, name), 1280);
    return NextResponse.json({ name });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

/** Files already captured or dropped into assets/. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const dir = path.join(projectDir(id), "assets");
  const files = await fs.readdir(dir).catch(() => [] as string[]);
  return NextResponse.json({ assets: files.filter((f) => /\.(jpe?g|png|webp)$/i.test(f)) });
}
