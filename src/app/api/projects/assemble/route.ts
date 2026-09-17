import { NextRequest, NextResponse } from "next/server";
import { createVideoProject, type MediaInput } from "@/lib/editor/media";
export const runtime = "nodejs";
export async function POST(req: NextRequest) {
  try {
    let name = "Untitled project", inputs: MediaInput[];
    if (req.headers.get("content-type")?.includes("multipart/form-data")) {
      const form = await req.formData();
      name = String(form.get("name") ?? name);
      inputs = await Promise.all(form.getAll("files").filter((f): f is File => f instanceof File).map(async f => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })));
    } else {
      const body = await req.json();
      name = String(body.name ?? name);
      // A name on its own creates an empty project; footage can be imported later.
      if (body.files === undefined || body.files === null) inputs = [];
      else if (!Array.isArray(body.files) || !body.files.every((f: unknown) => typeof f === "string")) throw new Error("Provide local video paths");
      else inputs = body.files.map((file: string) => ({ file }));
    }
    return NextResponse.json(await createVideoProject(name, inputs));
  } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }); }
}
