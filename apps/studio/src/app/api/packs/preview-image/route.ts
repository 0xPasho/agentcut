import { NextRequest } from "next/server";
import { readPackImage } from "@agentcut/core/modules/packs/server/packs";

export const runtime = "nodejs";

/**
 * A picture of a pack that is not installed yet, for the import preview: read from the
 * folder or URL being previewed, and only if its manifest names it as the cover or a
 * screenshot.
 */
export async function GET(req: NextRequest) {
  const source = req.nextUrl.searchParams.get("source") ?? "";
  const file = req.nextUrl.searchParams.get("file") ?? "";
  if (!source || !file) return new Response("not found", { status: 404 });
  try {
    const { bytes, type } = await readPackImage(source, file);
    return new Response(new Uint8Array(bytes), { headers: { "content-type": type, "cache-control": "private, max-age=300", "x-content-type-options": "nosniff" } });
  } catch {
    return new Response("not found", { status: 404 });
  }
}
