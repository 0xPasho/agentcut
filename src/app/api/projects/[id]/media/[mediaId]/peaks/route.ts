import { readEditor } from "@/modules/editor/server/store";
import { mediaPeaks } from "@/modules/media/server/peaks";

export const runtime = "nodejs";

/**
 * The loudness envelope of one imported source, so the timeline can draw a shot's own
 * audio. Computed by ffmpeg on this machine and cached next to the project: the file
 * itself is far too large to decode in the browser.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; mediaId: string }> }) {
  const { id, mediaId } = await params;
  let media;
  try { media = readEditor(id).edl.media.find(m => m.id === mediaId); }
  catch { return new Response("Project not found", { status: 404 }); }
  if (!media) return new Response("Media not found", { status: 404 });
  try {
    const peaks = await mediaPeaks(id, media);
    return Response.json(peaks, { headers: { "Cache-Control": "private, max-age=86400" } });
  } catch (error) {
    return new Response((error as Error).message, { status: 500 });
  }
}
