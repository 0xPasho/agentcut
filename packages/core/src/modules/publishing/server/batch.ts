import { readEditor } from "../../editor/server/store";
import { prepare, applyCopy, slots } from "./service";
import { proposeCopy } from "./copy";
import * as store from "./store";
import { dayInZone } from "../lib/resolve";

/** Production succeeds even if optional publication preparation needs attention. */
export async function prepareGenerated(projectId: string, sequenceIds: string[], report: (message: string) => void = () => {}) {
  if (!store.settings().autoPrepare) return;
  const prepared: string[] = [];
  for (const sequenceId of sequenceIds) {
    try {
      const p = prepare(projectId, sequenceId); prepared.push(p.id);
      if (p.revision !== 0) continue;
      const proposed = await proposeCopy(p.id, "Prepare concise publication copy for this newly generated video.");
      applyCopy(p.id, proposed.revision, proposed.copy);
    } catch (error) { report(`Publication draft: ${(error as Error).message}`); }
  }
  if (!prepared.length || !store.settings().slots.length) return;
  try {
    const candidates = prepared.map(store.publication).filter(p => !p.scheduledAt && p.destinations.length && p.destinations.every(d => d.state === "not_sent"));
    const result = slots(candidates.map(p => p.id), dayInZone(new Date().toISOString(), store.settings().timezone), 30, true, Object.fromEntries(candidates.map(p => [p.id, p.revision])));
    for (const missing of result.unavailable) report(missing.reason);
  } catch (error) { report(`Publication slots: ${(error as Error).message}`); }
}
export async function prepareAllGenerated(projectId: string, report?: (message: string) => void) { const { edl } = readEditor(projectId); return prepareGenerated(projectId, [...edl.clips, ...edl.sequences].map(v => v.id), report); }
