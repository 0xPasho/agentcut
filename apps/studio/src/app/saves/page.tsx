import { SavesView } from "@/modules/ideas/saves-view";
import { loadSaves } from "@agentcut/core/modules/ideas/server/pages";
export const dynamic = "force-dynamic";
export default function Page() {
  return <SavesView {...loadSaves()} />;
}
