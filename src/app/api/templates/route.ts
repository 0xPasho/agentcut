import { listTemplates } from "@/modules/templates/server/registry";

export const runtime = "nodejs";

/**
 * Every template on this machine, without a project in hand.
 *
 * The home screen offers a template before a project exists, which the project-scoped
 * `templates.list` tool cannot answer. Same registry, same documents — only the summary
 * a picker needs, so the response is not a wall of settings.
 */
export async function GET() {
  try {
    const templates = (await listTemplates()).map(t => ({
      id: t.id, name: t.name, description: t.description, tags: t.tags,
      builtin: t.builtin, output: t.output ?? null,
      // What this template asks to be chosen from a source, so a form can ask for a
      // clip count or a running time without guessing which one applies.
      makes: t.selection,
    }));
    return Response.json({ templates });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
}
