import { NextRequest } from "next/server";
import { DICTATION_LANGUAGES, dictate, type DictationLanguage } from "@agentcut/core/modules/transcription/server/dictate";
export const runtime = "nodejs";
export const maxDuration = 120;

/** Recorded speech in the body (webm, ogg or mp4), recognised locally. `?language=auto|es|en`. */
export async function POST(req: NextRequest) {
  const asked = req.nextUrl.searchParams.get("language") ?? "auto";
  const language = (DICTATION_LANGUAGES as readonly string[]).includes(asked) ? (asked as DictationLanguage) : "auto";
  try {
    const audio = Buffer.from(await req.arrayBuffer());
    if (audio.length > 50 * 1024 * 1024) return Response.json({ error: "Recording too long" }, { status: 413 });
    return Response.json(await dictate(audio, language));
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
}
