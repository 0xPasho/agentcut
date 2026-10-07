import { ConnectionsView } from "@/modules/publishing/connections-view";
import { loadPublishing } from "@agentcut/core/modules/publishing/server/pages";
export const dynamic = "force-dynamic";
export default async function Page() { return <ConnectionsView initial={await loadPublishing()} />; }
