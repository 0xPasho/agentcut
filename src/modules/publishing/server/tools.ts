import { removeExpiredEvidence } from "./evidence";
import { calendar } from "./calendar";
import { PublicationCommand } from "../types";
import type { ToolContext } from "../types";
import * as service from "./service";
import * as store from "./store";
import { syncOccupancy } from "./providers/occupancy";
import { saveConnection, addPhoneAccount, syncAccounts, connectLink } from "./providers/registry";
import { cancel, refresh, moveRemote, launchRunner } from "./runner";
import { buildPhoneTool, phoneReadiness } from "./phone/control";
import { startPhone, resumePhone, phoneAction, recordPhone, abortPhone } from "./phone/sessions";
import { proposeCopy } from "./copy";
import { applyImport, previewImport, rollbackImport } from "./import-cadence";

export async function executePublicationCommand(raw: unknown, context: ToolContext = { actor: "agent" }): Promise<unknown> {
  const call = PublicationCommand.parse(raw);
  if (context.projectId) {
    if ("projectId" in call && call.projectId && call.projectId !== context.projectId) throw new Error("This editor command belongs to another project");
    if (call.tool === "publication.overview") call.projectId = context.projectId;
    const ids = "ids" in call ? call.ids : "id" in call && call.tool.startsWith("publication.") ? [call.id] : "sessionId" in call ? [store.session(call.sessionId).publicationId] : [];
    for (const id of ids) if (id && store.publication(id).projectId !== context.projectId) throw new Error("This publication belongs to another project");
    if (call.tool.startsWith("publication.import.")) throw new Error("Import is a workspace command. Use the workspace publishing tools.");
  }
  switch (call.tool) {
    case "publication.calendar": return calendar(call.query);
    case "publication.overview": return service.overview(call.projectId);
    case "publication.prepare": return call.sequenceIds.map(id => service.prepare(call.projectId, id, call.accountIds, call.repeat));
    case "publication.read": return service.detail(store.publication(call.id));
    case "publication.patch": return service.patch(call.id, call.revision, call.patch, call.destinations);
    case "publication.approveVideo": return service.approveVideo(call.id, call.projectRevision, context.actor);
    case "publication.pin": return service.pin(call.id, call.revision, call.render);
    case "publication.validate": return service.validate(call.id);
    case "publication.batch": {
      const results = [];
      for (const item of call.items) {
        try { results.push({ id: item.id, ok: true, publication: await executePublicationCommand({ tool: `publication.${call.action}`, ...item, ...(call.action === "dispatch" ? { confirmed: call.confirmed } : {}) }, context) }); }
        catch (error) { results.push({ id: item.id, ok: false, error: (error as Error).message }); }
      }
      return results;
    }
    case "publication.authorize": {
      if (context.actor !== "human") throw new Error("The owner must authorize this exact publication in the editor before an agent can send it.");
      return store.transaction(() => {
        const p = store.publication(call.id); if (p.revision !== call.revision) throw new store.PublishingConflict(p);
        const issues = service.validate(p.id); if (issues.length) throw new Error(issues.map(i => i.message).join("\n"));
        store.put("approval", p.id, { revision: p.revision, actor: context.actor, at: Date.now() });
        return service.detail(p);
      });
    }
    case "publication.dispatch": {
      if (!call.confirmed) throw new Error("Review the exact video, text, accounts and times before sending this publication.");
      if (context.actor !== "human") {
        const approval = store.document("approval", call.id) as { revision: number } | null;
        if (approval?.revision !== call.revision) throw new Error("This payload has no current owner approval. Review and authorize it in the publication panel.");
      }
      const result = await service.dispatch(call.id, call.revision); launchRunner(); return result;
    }
    case "publication.refresh": return service.detail(await refresh(call.id));
    case "publication.cancel": return service.detail(await cancel(call.id, call.revision, call.destinationId));
    case "publication.move": return service.detail(await moveRemote(call.id, call.revision, call.destinationId, call.at));
    case "publication.reconcile": {
      if (context.actor === "agent") throw new Error("Use a phone session with screenshot evidence, refresh from the API, or ask the owner to record the observed result.");
      return service.detail(store.change(call.id, call.revision, p => {
        const d = p.destinations.find(d => d.id === call.destinationId); if (!d) throw new Error("Destination not found");
        if (["published", "cancelled"].includes(d.state)) throw new Error("A final delivery is history. Create a repeat publication instead of resetting it.");
        if (d.state === "sending") throw new Error("Wait for the current submission to finish before reconciling");
        if (call.state === "scheduled" && (!call.at || Date.parse(call.at) <= Date.now())) throw new Error("Enter the actual future time confirmed by the network");
        d.state = call.state; d.remoteId = call.remoteId; d.remoteUrl = call.remoteUrl; d.checkedAt = Date.now(); d.error = null;
        if (call.state === "scheduled") d.confirmedAt = call.at;
        if (call.state === "published") d.publishedAt = call.at ?? new Date().toISOString();
        if (call.state === "not_sent") { d.payload = null; d.payloadHash = null; d.remoteId = null; d.confirmedAt = null; }
        store.put("verification", `${p.id}:${d.id}:${Date.now()}`, { actor: context.actor, note: call.note, state: call.state, at: Date.now() });
      }));
    }
    case "publication.slots": return service.slots(call.ids, call.from, call.days, call.reserve, call.revisions);
    case "publication.copy.propose": return proposeCopy(call.id, call.instruction);
    case "publication.copy.apply": return service.applyCopy(call.id, call.revision, call.copy);
    case "publishing.settings.save": return service.saveSettings(call.settings);
    case "publishing.connection.save": return saveConnection(call);
    case "publishing.connection.link": return connectLink(call.connectionId, call.network, call.returnUrl);
    case "publishing.calendar.sync": return syncOccupancy(call.connectionId);
    case "publishing.account.link": return store.transaction(() => {
      const account = store.account(call.accountId);
      if (call.equivalentTo) {
        const target = store.account(call.equivalentTo);
        if (target.id === account.id || target.network !== account.network || target.equivalentTo) throw new Error("Choose a different canonical account on the same network");
        if (store.accounts().some(a => a.equivalentTo === account.id)) throw new Error("This is already a canonical account. Link the other route to it instead.");
      }
      const next = { ...account, equivalentTo: call.equivalentTo }; store.put("account", next.id, next); return next;
    });
    case "publishing.accounts.sync": return syncAccounts(call.connectionId);
    case "publishing.account.phone": return addPhoneAccount(call.connectionId, call.network, call.name, call.remoteId);
    case "publishing.evidence.cleanup": return removeExpiredEvidence();
    case "publishing.phone.readiness": return phoneReadiness();
    case "publishing.phone.build": return buildPhoneTool();
    case "publication.phone.start": { const result = await startPhone(call.id); if (call.run) launchRunner(result.session.id); return result; }
    case "publication.phone.resume": { const result = await resumePhone(call.sessionId); if (call.run && result.session.status !== "done") launchRunner(call.sessionId); return result; }
    case "publication.phone.action": return phoneAction(call.sessionId, call.action, call.note);
    case "publication.phone.record": return recordPhone(call);
    case "publication.phone.abort": return abortPhone(call.sessionId, call.reason);
    case "publication.import.rollback": return rollbackImport(call.importId);
    case "publication.import.preview": return previewImport(call.file, call.accountMap, call.sourceMap);
    case "publication.import.apply": return applyImport(call.file, call.accountMap, call.sourceMap);
  }
}
