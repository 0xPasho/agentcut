import { NextRequest } from "next/server";
import { z } from "zod";
import { detectHarnesses } from "@/lib/agent/detect";
import { refreshAll } from "@/lib/agent/models/cache";
import { applySelection, selectionOverview, SelectionRequest } from "@/lib/agent/selection";
export const runtime = "nodejs";
// Discovery spawns four CLIs; the default serverless budget would cut it short.
export const maxDuration = 120;

/**
 * Which harnesses this machine has, which models each offers, and which one is
 * selected. One endpoint for every prompt surface — the picker is the same
 * object everywhere, so it reads the same state everywhere.
 *
 * `?projectId=` asks for a project's effective selection and its own override
 * separately, because a settings UI that shows an inherited value as if the
 * project had set it will have people "clearing" something they never set.
 */
export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("projectId") ?? undefined;
  try {
    const harnesses = await detectHarnesses();
    return Response.json({ harnesses, ...selectionOverview(projectId) });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
}

// One schema for every surface that picks a harness: the prompt composer's picker,
// the settings page and the `agents.select` tool all parse the same request here.
const Select = SelectionRequest.extend({ action: z.literal("select") });

const Refresh = z.object({ action: z.literal("refresh"), projectId: z.string().optional() });

export async function POST(req: NextRequest) {
  try {
    const body = z.union([Select, Refresh]).parse(await req.json());
    if (body.action === "refresh") {
      // Only the installed ones: probing a CLI that is not there spends the
      // whole timeout to learn what `resolveBinary` already answered.
      const installed = (await detectHarnesses()).filter((h) => h.installed).map((h) => h.id);
      const results = await refreshAll(installed);
      return Response.json({ results, harnesses: await detectHarnesses() });
    }
    // A picker that names a project means the project scope; the settings page says so.
    applySelection({ ...body, scope: body.scope === "workspace" && body.projectId ? "project" : body.scope });
    return Response.json(selectionOverview(body.projectId));
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}
