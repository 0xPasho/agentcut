import { NextRequest, NextResponse } from "next/server";
import { createVideoProject, type MediaInput } from "@/modules/media/server/media-import";
import { startJob } from "@/modules/project/server/jobs";
export const runtime = "nodejs";

/** Several raw videos become one project with one video each, and the batch starts at once. */
export async function POST(req: NextRequest) {
  try {
    let name = "Untitled set", brief = "", inputs: MediaInput[];
    if (req.headers.get("content-type")?.includes("multipart/form-data")) {
      const form = await req.formData();
      name = String(form.get("name") ?? name); brief = String(form.get("brief") ?? "");
      inputs = await Promise.all(form.getAll("files").filter((f): f is File => f instanceof File).map(async f => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })));
    } else {
      const body = await req.json();
      name = String(body.name ?? name); brief = String(body.brief ?? "");
      if (!Array.isArray(body.files) || !body.files.every((f: unknown) => typeof f === "string")) throw new Error("Provide local video paths");
      inputs = body.files.map((file: string) => ({ file }));
    }
    if (!inputs.length) throw new Error("A batch needs at least one video");
    const project = await createVideoProject(name, inputs, { layout: "separate" });
    const job = startJob(project.id, "batch", { userBrief: brief });
    return NextResponse.json({ ...project, job });
  } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }); }
}
