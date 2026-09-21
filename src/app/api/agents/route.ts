import { NextRequest } from "next/server";
import { z } from "zod";
import { detectHarnesses } from "@/lib/agent/detect";
import { refreshAll } from "@/lib/agent/models/cache";
import { resolveSelection, saveSelection, storedSelection } from "@/lib/agent/selection";
import { HARNESS_IDS } from "@/lib/agent/registry";
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
    return Response.json({
      harnesses,
      selection: resolveSelection(projectId),
      override: projectId ? storedSelection(projectId) : null,
      workspaceDefault: storedSelection(),
    });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
}

const Select = z.object({
  action: z.literal("select"),
  provider: z.enum(HARNESS_IDS as [string, ...string[]]).or(z.literal("")),
  model: z.string().default(""),
  projectId: z.string().optional(),
});

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
    saveSelection({ provider: body.provider as never, model: body.model }, body.projectId);
    return Response.json({
      selection: resolveSelection(body.projectId),
      override: body.projectId ? storedSelection(body.projectId) : null,
    });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}
