import fs from "node:fs/promises";
import path from "node:path";
import * as store from "./store";
import { sessionDir } from "./phone/sessions";

/** Explicit retention action; it never changes a delivery result or deletes an export. */
export async function removeExpiredEvidence() {
  const threshold = Date.now() - store.settings().evidenceRetentionDays * 86400_000;
  let removed = 0;
  for (const session of store.sessions()) {
    if (session.status === "active" || session.updatedAt >= threshold || store.leaseHeld(`phone-agent:${session.id}`) || store.leaseHeld(`phone-action:${session.id}`)) continue;
    const owner = `cleanup:${session.id}`;
    if (!store.claimLease("phone", owner, 60_000)) continue;
    try {
      const current = store.session(session.id);
      if (current.status === "active" || current.updatedAt >= threshold) continue;
      for (const id of current.evidence) { await fs.rm(path.join(sessionDir(current.id), `${id}.png`), { force: true }); removed++; }
      await fs.rm(path.join(sessionDir(current.id), "agent"), { recursive: true, force: true });
      store.transaction(() => {
        const p = store.publication(current.publicationId);
        for (const d of p.destinations) d.evidence = d.evidence.filter(id => !current.evidence.includes(id));
        p.revision++; store.savePublication(p);
        store.put("evidence-retention", current.id, { removed: current.evidence.length, at: Date.now() });
        current.evidence = []; store.put("session", current.id, current);
      });
    } finally { store.releaseLease("phone", owner); }
  }
  return { removed };
}
