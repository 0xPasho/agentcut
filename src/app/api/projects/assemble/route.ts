import { NextRequest, NextResponse } from "next/server";
import { createVideoProject, type MediaInput } from "@/modules/media/server/media-import";
import { ASPECTS } from "@/modules/project/data";
export const runtime = "nodejs";

const outputFor = (aspect: string) => ASPECTS[aspect] ?? null;
export async function POST(req: NextRequest) {
  try {
    let name = "Untitled project", inputs: MediaInput[];
    // Several files can mean one video made of them, or one video each. Only the person
    // dropping them knows which, so it is asked rather than guessed.
    let layout: "together" | "separate" = "together";
    let aspect = "";
    // Whether this project's starting footage recognises itself. Absent follows the
    // workspace setting; "false" is the per-import opt-out for a drop of b-roll.
    let transcribe: boolean | undefined;
    if (req.headers.get("content-type")?.includes("multipart/form-data")) {
      const form = await req.formData();
      name = String(form.get("name") ?? name);
      if (form.get("layout") === "separate") layout = "separate";
      aspect = String(form.get("aspect") ?? "");
      const asked = form.get("transcribe");
      if (asked !== null) transcribe = asked !== "false" && asked !== "0";
      inputs = await Promise.all(form.getAll("files").filter((f): f is File => f instanceof File).map(async f => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })));
    } else {
      const body = await req.json();
      name = String(body.name ?? name);
      if (body.layout === "separate") layout = "separate";
      aspect = typeof body.aspect === "string" ? body.aspect : "";
      if (typeof body.transcribe === "boolean") transcribe = body.transcribe;
      // A name on its own creates an empty project; footage can be imported later.
      if (body.files === undefined || body.files === null) inputs = [];
      else if (!Array.isArray(body.files) || !body.files.every((f: unknown) => typeof f === "string")) throw new Error("Provide local video paths");
      else inputs = body.files.map((file: string) => ({ file }));
    }
    return NextResponse.json(await createVideoProject(name, inputs, { layout, ...(transcribe === undefined ? {} : { transcribe }), ...(outputFor(aspect) ? { output: outputFor(aspect)! } : {}) }));
  } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }); }
}
