import path from "node:path";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";
import { projectDir } from "@/lib/config";
import { isUrl, titleFor } from "@/lib/ingest";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    projects: q.listProjects().map((p) => ({
      id: p.id,
      name: p.name,
      status: p.status,
      createdAt: p.created_at,
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

  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "no file" }, { status: 400 });
    sourcePath = path.join(dir, `source${path.extname(file.name) || ".mp4"}`);
    await fs.writeFile(sourcePath, Buffer.from(await file.arrayBuffer()));
    name = file.name;
  } else {
    const body = (await req.json()) as { source?: string };
    const source = body.source?.trim();
    if (!source) return NextResponse.json({ error: "source required" }, { status: 400 });
    if (isUrl(source)) {
      sourcePath = source;
      name = await titleFor(source);
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
