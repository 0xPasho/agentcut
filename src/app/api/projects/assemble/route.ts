import { NextRequest, NextResponse } from "next/server";
import { createVideoProject, type MediaInput } from "@/lib/editor/media";
export const runtime = "nodejs";

/**
 * The shapes the home screen offers, by name. Choosing one is a decision about the video
 * being made; without one the project takes the shape of its first source, as before.
 */
const ASPECTS: Record<string, { width: number; height: number; fps: number }> = {
  "9:16": { width: 1080, height: 1920, fps: 30 },
  "4:5": { width: 1080, height: 1350, fps: 30 },
  "1:1": { width: 1080, height: 1080, fps: 30 },
  "16:9": { width: 1920, height: 1080, fps: 30 },
};
const outputFor = (aspect: string) => ASPECTS[aspect] ?? null;
export async function POST(req: NextRequest) {
  try {
    let name = "Untitled project", inputs: MediaInput[];
    // Several files can mean one video made of them, or one video each. Only the person
    // dropping them knows which, so it is asked rather than guessed.
    let layout: "together" | "separate" = "together";
    let aspect = "";
    if (req.headers.get("content-type")?.includes("multipart/form-data")) {
      const form = await req.formData();
      name = String(form.get("name") ?? name);
      if (form.get("layout") === "separate") layout = "separate";
      aspect = String(form.get("aspect") ?? "");
      inputs = await Promise.all(form.getAll("files").filter((f): f is File => f instanceof File).map(async f => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })));
    } else {
      const body = await req.json();
      name = String(body.name ?? name);
      if (body.layout === "separate") layout = "separate";
      aspect = typeof body.aspect === "string" ? body.aspect : "";
      // A name on its own creates an empty project; footage can be imported later.
      if (body.files === undefined || body.files === null) inputs = [];
      else if (!Array.isArray(body.files) || !body.files.every((f: unknown) => typeof f === "string")) throw new Error("Provide local video paths");
      else inputs = body.files.map((file: string) => ({ file }));
    }
    return NextResponse.json(await createVideoProject(name, inputs, { layout, ...(outputFor(aspect) ? { output: outputFor(aspect)! } : {}) }));
  } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }); }
}
