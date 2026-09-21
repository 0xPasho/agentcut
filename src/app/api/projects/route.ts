import path from "node:path";
import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";
import { projectDir } from "@/lib/config";
import { isUrl, titleFor } from "@/lib/ingest";
import { reapDeadJobs } from "@/lib/reaper";

export const runtime = "nodejs";

export async function GET() {
  // The project list is the first thing loaded after a restart: sweep every project
  // here so a crash leaves at most one stale row, visible to nobody.
  reapDeadJobs();
  return NextResponse.json({
    projects: q.listProjects().map((p) => ({
      id: p.id,
      name: p.name,
      status: p.status,
      createdAt: p.created_at,
      sequenceCount: p.edl ? (JSON.parse(p.edl).sequences?.length ?? 0) : 0,
                clipCount: p.edl ? (JSON.parse(p.edl).clips?.length ?? 0) : 0,
    })),
  });
}

export async function POST(req: NextRequest) {
  const id = randomUUID().slice(0, 10);
  const dir = projectDir(id);
  const contentType = req.headers.get("content-type") ?? "";

  let sourcePath: string;
  let name: string;

  const uploadName = req.headers.get("x-file-name");
  if (uploadName) {
    // A dropped file arrives as the raw body and is written as it arrives. Buffering it
    // instead put the whole recording in memory, which failed outright past two gigabytes
    // — the size of an ordinary stream recording — with nothing but a 500 to show for it.
    if (!req.body) return NextResponse.json({ error: "no file" }, { status: 400 });
    name = decodeURIComponent(uploadName);
    sourcePath = path.join(dir, `source${path.extname(name) || ".mp4"}`);
    try {
      await pipeline(Readable.fromWeb(req.body as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(sourcePath));
    } catch (e) {
      await fs.rm(dir, { recursive: true, force: true });
      return NextResponse.json({ error: `${name} could not be saved: ${(e as Error).message}` }, { status: 400 });
    }
  } else if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "no file" }, { status: 400 });
    sourcePath = path.join(dir, `source${path.extname(file.name) || ".mp4"}`);
    await pipeline(Readable.fromWeb(file.stream() as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(sourcePath));
    name = file.name;
  } else {
    const body = (await req.json()) as { source?: string };
    const source = body.source?.trim();
    if (!source) return NextResponse.json({ error: "source required" }, { status: 400 });
    if (isUrl(source)) {
      sourcePath = source;
      // The title comes from the site, which may be unreachable or refuse the link. The
      // link is still a project: fall back to it rather than failing the whole request.
      name = await titleFor(source).catch(() => source);
    } else {
      sourcePath = path.resolve(source.replace(/^~/, process.env.HOME ?? "~"));
      try {
        await fs.access(sourcePath);
      } catch {
        return NextResponse.json({ error: `file not found: ${sourcePath}` }, { status: 400 });
      }
      name = path.basename(sourcePath);
    }
  }

  q.insertProject({ id, name, source_path: sourcePath, created_at: Date.now() });
  return NextResponse.json({ id, name });
}
