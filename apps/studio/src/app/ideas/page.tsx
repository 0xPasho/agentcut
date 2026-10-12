import { IdeasView } from "@/modules/ideas/ideas-view";
import { loadIdeas } from "@agentcut/core/modules/ideas/server/pages";
export const dynamic = "force-dynamic";
export default async function Page({ searchParams }: { searchParams: Promise<{ open?: string | string[] }> }) {
  return <IdeasView {...loadIdeas(await searchParams)} />;
}
