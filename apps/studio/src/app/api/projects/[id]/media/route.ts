import { NextRequest, NextResponse } from "next/server";
import { importProjectMedia, type MediaInput } from "@agentcut/core/modules/media/server/media-import";
import { RevisionConflict } from "@agentcut/core/modules/editor/server/store";
export const runtime = "nodejs";

/** "yes"/"no" for this one upload; absent follows the project's own setting. */
const transcribeFlag = (asked: string | null | undefined) => (asked === null || asked === undefined ? undefined : asked !== "false" && asked !== "0");

/**
 * A video the browser could not name by path. It arrives as the raw body, under
 * `x-file-name`, `x-expected-revision` and `x-transcribe` headers, and is written to
 * the project as it arrives: a recording is bigger than memory. The multipart form is
 * kept for callers that already speak it, streamed file by file.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const uploadName = req.headers.get("x-file-name");
    let input: MediaInput, expectedRevision: number, transcribe: boolean | undefined;
    if (uploadName) {
      if (!req.body) throw new Error("Choose a video file");
      input = { name: decodeURIComponent(uploadName), stream: req.body };
      expectedRevision = Number(req.headers.get("x-expected-revision"));
      transcribe = transcribeFlag(req.headers.get("x-transcribe"));
    } else {
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) throw new Error("Choose a video file");
      input = { name: file.name, stream: file.stream() };
      expectedRevision = Number(form.get("expectedRevision"));
      transcribe = transcribeFlag(form.get("transcribe") as string | null);
    }
    return NextResponse.json(await importProjectMedia(id, expectedRevision, input, undefined, { transcribe }));
  } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: e instanceof RevisionConflict ? 409 : 400 }); }
}
