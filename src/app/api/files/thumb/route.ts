import { NextRequest } from "next/server";
import { fileResponse } from "@/common/server/http-file";
import { localThumbnail } from "@/modules/media/server/local-thumbnail";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const asked = req.nextUrl.searchParams.get("path");
  if (!asked) return new Response("path required", { status: 400 });
  try {
    const picture = await localThumbnail(asked);
    if (!picture) return new Response("nothing to picture", { status: 404 });
    const res = await fileResponse(picture, null);
    res.headers.set("Cache-Control", "private, max-age=3600");
    return res;
  } catch (e) {
    return new Response((e as Error).message, { status: 404 });
  }
}
