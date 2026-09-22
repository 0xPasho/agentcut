import { NextRequest, NextResponse } from "next/server";
import { q } from "@/common/server/db";
import { projectSummary } from "@/modules/project/lib/summary";
import { createFromForm, createFromSource, createFromUpload, type Created } from "@/modules/project/server/create";
import { reapDeadJobs } from "@/modules/project/server/reaper";

export const runtime = "nodejs";

export async function GET() {
  // The project list is the first thing loaded after a restart: sweep every project
  // here so a crash leaves at most one stale row, visible to nobody.
  reapDeadJobs();
  return NextResponse.json({ projects: q.listProjects().map(projectSummary) });
}

export async function POST(req: NextRequest) {
  const uploadName = req.headers.get("x-file-name");
  const created: Created = uploadName
    ? await createFromUpload(uploadName, req.body)
    : (req.headers.get("content-type") ?? "").includes("multipart/form-data")
      ? await createFromForm((await req.formData()).get("file"))
      : await createFromSource(((await req.json()) as { source?: string }).source);
  if ("error" in created) return NextResponse.json(created, { status: 400 });
  return NextResponse.json(created);
}
