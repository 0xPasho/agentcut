import { NextRequest, NextResponse } from "next/server";
import { searchImages, adoptHit, type ImageHit } from "@/lib/search";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get("q")?.trim();
  if (!query) return NextResponse.json({ error: "q required" }, { status: 400 });
  // `providers` restricts the search the same way the project tool does, so this
  // route and `assets.search` cannot answer the same question differently.
  const providers = req.nextUrl.searchParams.get("providers")?.split(",").map(p => p.trim()).filter(Boolean);
  try {
    return NextResponse.json({ hits: await searchImages(query, 12, providers?.length ? providers : undefined) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}

/** Download a chosen hit into the project and register it with its licence. */
export async function POST(req: NextRequest) {
  const body = (await req.json()) as { hit?: ImageHit; projectId?: string };
  if (!body.hit || !body.projectId) {
    return NextResponse.json({ error: "hit and projectId required" }, { status: 400 });
  }
  try {
    return NextResponse.json({ asset: await adoptHit(body.hit, body.projectId) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
