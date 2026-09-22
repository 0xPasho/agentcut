import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { q } from "../db";
import { projectDir } from "../config";
import { grabFrame } from "../media";
import { scanLibrary, registerAsset, uploadLibraryAsset } from "../assets";
import { searchImages, adoptHit, listProviders, searchAudio, adoptAudioHit } from "../search";
import { TemplateRequest } from "../templates/plan";
import { RuleApplyRequest } from "../rules/apply";
import { RuleLevel, RuleStage } from "../rules/schema";
import { PlanApplyRequest } from "../plan/apply";
import { DeriveRequest } from "./derive";
import { EditRequest, EditorOperation } from "./operations";
import { editProject, readEditor } from "./store";
import { jobState, JOB_ACTIVE } from "../job-state";
import { transcriptionState } from "../transcribe/media";
import { reapDeadJobs } from "../reaper";

/** What a found sound is for. A sting and a bed are the same search with different ranking. */
const AudioKindSchema = z.enum(["sfx", "music"]).default("sfx");

export const EditorToolCall = z.discriminatedUnion("tool", [
  z.object({ tool: z.literal("project.read") }),
  // What is happening right now, for any interface that has to wait: the running
  // job and everything logged since `since`. Read-only, and safe to poll.
  z.object({ tool: z.literal("project.status"), since: z.number().int().nonnegative().default(0), limit: z.number().int().positive().max(500).default(50) }),
  // The same escape hatch the panel's "Stop and unlock" button uses.
  z.object({ tool: z.literal("project.unlock") }),
  // Did it come out the way the template said? Reads the exported pixels, not the
  // project: everything a template promises is visible there and nowhere else.
  z.object({ tool: z.literal("style.audit"), sequenceId: z.string().optional() }),
  z.object({ tool: z.literal("media.import"), file: z.string().min(1), expectedRevision: z.number().int().nonnegative(),
    /** Also place the imported video as a shot: on this sequence, at output seconds (null appends), on a layer. */
    place: z.object({ sequenceId: z.string(), at: z.number().nonnegative().nullable().optional(), layer: z.number().int().nonnegative().optional() }).optional(),
    /** Recognise this source's speech, or not. Omitted follows the project's setting. */
    transcribe: z.boolean().optional() }),
  z.object({ tool: z.literal("media.upload"), name: z.string().min(1), base64: z.string().min(1), expectedRevision: z.number().int().nonnegative(), transcribe: z.boolean().optional() }),
  z.object({ tool: z.literal("project.edit"), ...EditRequest.shape }),
  z.object({ tool: z.literal("assets.browseLocal"), folder: z.string().optional(), offset: z.number().int().nonnegative().default(0), limit: z.number().int().positive().max(5000).default(100) }),
  z.object({ tool: z.literal("assets.importLocal"), file: z.string().min(1) }),
  z.object({ tool: z.literal("assets.list"), kind: z.enum(["image", "audio", "video"]) }),
  // The panel has always had a way to take something out of the library. An agent that
  // imported the wrong file could only ask somebody else to remove it.
  z.object({ tool: z.literal("assets.delete"), id: z.string().min(1) }),
  z.object({ tool: z.literal("assets.capture"), atSec: z.number().nonnegative(), mediaId: z.string().optional() }),
  z.object({ tool: z.literal("assets.search"), query: z.string().trim().min(1), providers: z.array(z.string()).optional() }),
  z.object({ tool: z.literal("assets.providers") }),
  // Sounds are searched and adopted exactly like pictures: find, download into the
  // project, reference the asset id from a music or sfx edit.
  z.object({ tool: z.literal("assets.searchAudio"), query: z.string().trim().min(1), kind: AudioKindSchema }),
  z.object({ tool: z.literal("assets.adoptAudio"), query: z.string().trim().min(1), kind: AudioKindSchema, id: z.string(), provider: z.string().default("openverse") }),
  z.object({ tool: z.literal("assets.importFolder"), folder: z.string().min(1) }),
  z.object({ tool: z.literal("assets.adopt"), query: z.string().trim().min(1), provider: z.string(), id: z.string(), providers: z.array(z.string()).optional() }),
  z.object({ tool: z.literal("assets.upload"), name: z.string().min(1), base64: z.string().min(1).max(100_000_000) }),
  z.object({ tool: z.literal("assets.import"), file: z.string().min(1) }),
  z.object({ tool: z.literal("project.render"), only: z.array(z.string()).optional(), expectedRevision: z.number().int().nonnegative() }),
  z.object({ tool: z.literal("transcript.resync"), expectedRevision: z.number().int().nonnegative(), brief: z.string().optional() }),
  z.object({ tool: z.literal("templates.list") }),
  z.object({ tool: z.literal("templates.schema") }),
  z.object({ tool: z.literal("templates.get"), id: z.string().min(1) }),
  z.object({ tool: z.literal("templates.save"), template: z.unknown().optional(),
    from: z.string().optional(), id: z.string().optional(), name: z.string().optional(),
    author: z.string().optional(), overrides: z.record(z.string(), z.unknown()).optional() }),
  z.object({ tool: z.literal("templates.delete"), id: z.string().min(1) }),
  z.object({ tool: z.literal("templates.looks") }),
  // `sequenceId` draws it in the shape of that video, variants and all, which is what a
  // panel beside a square copy needs; `aspect` names a shape directly.
  z.object({ tool: z.literal("templates.preview"), id: z.string().min(1), aspect: z.string().optional(), sequenceId: z.string().optional() }),
  z.object({ tool: z.literal("sequence.derive"), ...DeriveRequest.shape, expectedRevision: z.number().int().nonnegative() }),
  z.object({ tool: z.literal("templates.suggest"), sequenceId: z.string().optional(), clipId: z.string().optional(), slots: z.record(z.string(), z.unknown()).optional() }),
  z.object({ tool: z.literal("template.plan"), ...TemplateRequest.shape }),
  z.object({ tool: z.literal("template.apply"), ...TemplateRequest.shape, expectedRevision: z.number().int().nonnegative() }),
  // The stream's chat: where it is read from, the comments around a video ranked by what
  // the clip says, and choosing the one the video opens on (or none). The template's
  // `comment` section makes the same choice on its own; these are the same choice by hand.
  z.object({ tool: z.literal("chat.source") }),
  z.object({ tool: z.literal("chat.setSource"), path: z.string() }),
  z.object({ tool: z.literal("comments.list"), sequenceId: z.string().optional(), clipId: z.string().optional(), limit: z.number().int().positive().max(100).default(25) }),
  z.object({ tool: z.literal("comments.place"), sequenceId: z.string().optional(), clipId: z.string().optional(),
    commentId: z.union([z.number().int().nonnegative(), z.literal("none")]), seconds: z.number().positive().max(10).optional(),
    expectedRevision: z.number().int().nonnegative() }),
  z.object({ tool: z.literal("rules.list") }),
  z.object({ tool: z.literal("rules.get"), id: z.string().min(1) }),
  z.object({ tool: z.literal("rules.schema") }),
  z.object({ tool: z.literal("rules.save"), rule: z.unknown(), level: RuleLevel.default("workspace") }),
  z.object({ tool: z.literal("rules.delete"), id: z.string().min(1), level: RuleLevel.default("workspace") }),
  z.object({ tool: z.literal("rules.evaluate"), sequenceId: z.string().optional(), clipId: z.string().optional(), stage: RuleStage.optional() }),
  z.object({ tool: z.literal("rules.apply"), ...RuleApplyRequest.shape, expectedRevision: z.number().int().nonnegative() }),
  z.object({ tool: z.literal("plan.read") }),
  z.object({ tool: z.literal("plan.generate"), scope: z.enum(["sequence", "project"]).default("sequence"), sequenceId: z.string().optional(), clipId: z.string().optional() }),
  z.object({ tool: z.literal("plan.apply"), ...PlanApplyRequest.shape, all: z.boolean().default(false), expectedRevision: z.number().int().nonnegative() }),
  // Recognise imported media. `background: true` queues it and returns at once —
  // the same call the retry in the asset panel makes; without it the call blocks
  // until the words are written, which is what an agent that needs them wants.
  // `force` ignores both the cached transcript and the skip rules.
  z.object({ tool: z.literal("media.transcribe"), mediaIds: z.array(z.string()).optional(), brief: z.string().optional(), force: z.boolean().optional(),
    background: z.boolean().default(false), by: z.string().optional() }),
  // Where every source's words stand, and the setting that decides whether a newly
  // imported one recognises itself. Read-only; `media.transcription.set` writes.
  z.object({ tool: z.literal("media.transcription") }),
  z.object({ tool: z.literal("media.transcription.set"), mode: z.enum(["audio", "always", "off"]).nullable(), level: RuleLevel.default("workspace") }),
  z.object({ tool: z.literal("project.batch"), brief: z.string().optional(), force: z.boolean().optional() }),
  z.object({ tool: z.literal("observations.read"), limit: z.number().int().positive().max(500).default(100), allProjects: z.boolean().default(true) }),
  z.object({ tool: z.literal("observations.review") }),
  z.object({ tool: z.literal("packs.list") }),
  z.object({ tool: z.literal("packs.inspect"), source: z.string().min(1) }),
  z.object({ tool: z.literal("packs.import"), source: z.string().min(1), replace: z.boolean().default(false) }),
  z.object({ tool: z.literal("packs.remove"), id: z.string().min(1) }),
  z.object({ tool: z.literal("packs.export"), id: z.string().min(1), name: z.string().min(1), version: z.string().optional(), description: z.string().optional(), author: z.string().optional(),
    templates: z.array(z.string()).optional(), rules: z.array(z.string()).optional(), glossary: z.boolean().optional(), assetIds: z.array(z.string()).optional(),
    quickActions: z.array(z.object({ label: z.string(), text: z.string() })).optional(), dir: z.string().optional() }),
  z.object({ tool: z.literal("quickactions.list") }),
  z.object({ tool: z.literal("conversation.undo"), messageId: z.number().int().positive(), expectedRevision: z.number().int().nonnegative().optional() }),
  z.object({ tool: z.literal("conversation.read"), limit: z.number().int().positive().max(500).default(50) }),
  z.object({ tool: z.literal("glossary.get") }),
  z.object({ tool: z.literal("glossary.save"), glossary: z.unknown(), level: RuleLevel.default("workspace") }),
  z.object({ tool: z.literal("preferences.get") }),
  z.object({ tool: z.literal("preferences.set"), text: z.string(), level: RuleLevel.default("workspace") }),
  // The first-run interview. Workspace level, like the preferences it writes: an
  // agent asks the questions in conversation, the web asks them full screen, and
  // both save through these. Never a precondition for editing.
  z.object({ tool: z.literal("onboarding.status") }),
  z.object({ tool: z.literal("onboarding.answer"), answers: z.record(z.string(), z.string()) }),
  z.object({ tool: z.literal("onboarding.run"), answers: z.record(z.string(), z.string()).default({}) }),
  z.object({ tool: z.literal("onboarding.skip") }),
  z.object({ tool: z.literal("onboarding.reopen") }),
  // Workspace configuration: which harness and model does which kind of work, and
  // the keys for the optional online providers. Both are settings the owner changes
  // on the settings page, so both are tools — the page is not allowed a private
  // path to them. A key is write-only through `providerkeys.set`: neither the page
  // nor an agent can read one back, which is why showing them the same thing is parity.
  z.object({ tool: z.literal("agents.status") }),
  z.object({ tool: z.literal("agents.select"), scope: z.enum(["workspace", "project", "task"]).default("workspace"), task: z.string().optional(), provider: z.string(), model: z.string().default("") }),
  z.object({ tool: z.literal("providerkeys.list") }),
  z.object({ tool: z.literal("providerkeys.set"), id: z.string().min(1), value: z.string() }),
]);
export const editorToolSchema = () => z.toJSONSchema(EditorToolCall);
export const editorOperationSchema = () => z.toJSONSchema(EditorOperation);

/**
 * Grab one frame and register it. The caller says which media and where its file is,
 * because not every caller is reading the saved project: applying a template resolves
 * pictures against the timeline its operations are about to produce.
 */
export async function captureFrameAsset(projectId: string, media: { id: string; file: string; durationSec?: number }, atSec: number) {
  const at = z.number().nonnegative().parse(atSec);
  if (media.durationSec !== undefined && at >= media.durationSec) throw new Error("Capture time must be inside the source");
  const dir = path.join(projectDir(projectId), "assets");
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `frame-${media.id}-${Math.round(at * 1000)}.jpg`);
  await grabFrame(media.file, at, file, 1280);
  return registerAsset({ file, scope: "project", projectId, source: "capture" });
}

export async function captureAsset(projectId: string, atSec: number, mediaId?: string) {
  const project = q.getProject(projectId);
  if (!project) throw new Error("Project not found");
  const edl = project.edl ? readEditor(projectId).edl : undefined;
  const media = mediaId ? edl?.media.find(m => m.id === mediaId) : undefined;
  if (mediaId && !media) throw new Error("Source media not found");
  // Without a media ID this captures the primary source, which a source-free project
  // does not have. Say so rather than probing an empty path.
  const primary = edl ? edl.source?.file ?? null : project.source_path || null;
  const from = media?.file ?? primary;
  if (!from) throw new Error("This project has no source video. Choose imported media to capture a frame from.");
  return captureFrameAsset(projectId, { id: media?.id ?? "primary", file: from, durationSec: media?.durationSec ?? edl?.source?.durationSec }, atSec);
}

/**
 * Where a tool reports what it is doing while it does it. Slow tools — a render, a
 * transcription, an agent judging rules — call this as they go so the caller has
 * something to show instead of a spinner.
 */
export type ToolActivity = (e: { kind: string; name?: string; text: string }) => void;

/**
 * Tools about the owner rather than about a project. A terminal agent must be able
 * to run the interview, read which harnesses this machine has or save a key before
 * the first project exists, so these skip the project check.
 */
const WORKSPACE_TOOLS = ["onboarding.", "agents.", "providerkeys.", "chat."];

/** The host binds projectId; agents cannot select another project through tool arguments. */
export async function executeEditorTool(projectId: string, raw: unknown, onActivity?: ToolActivity): Promise<unknown> {
  const call = EditorToolCall.parse(raw);
  const report = (text: string, kind = "log") => onActivity?.({ kind, name: call.tool, text });
  // The interview is about the owner, not about a project: a terminal agent must be
  // able to run it before the first project exists. Everything else needs one.
  if (!WORKSPACE_TOOLS.some((prefix) => call.tool.startsWith(prefix)) && !q.getProject(projectId)) throw new Error("Project not found");
  switch (call.tool) {
    case "project.read": return readEditor(projectId);
    case "project.status": return projectStatus(projectId, call.since, call.limit);
    case "project.unlock": {
      const { reapDeadJobs, unlockProject } = await import("../reaper");
      const reaped = reapDeadJobs(projectId);
      const stopped = unlockProject(projectId);
      if (stopped) report(`released the ${stopped.kind} job holding this project`, "tool");
      return { reaped: reaped.map((j) => ({ id: j.id, kind: j.kind })), stopped: stopped ? { id: stopped.id, kind: stopped.kind } : null };
    }
    case "style.audit": {
      const { auditStyle } = await import("./style-check");
      const audits = await auditStyle(projectId, call.sequenceId);
      const failed = audits.flatMap((a) => a.checks.filter((c) => !c.ok));
      report(`read ${audits.length} video${audits.length === 1 ? "" : "s"} back out of the export: ${failed.length ? `${failed.length} check${failed.length === 1 ? "" : "s"} failed` : "everything matches the template"}`, "tool");
      return audits;
    }
    case "media.import": case "media.upload": {
      const { importProjectMedia } = await import("./media");
      if (call.tool === "media.upload") return importProjectMedia(projectId, call.expectedRevision, { name: call.name, bytes: Buffer.from(call.base64, "base64") }, undefined, { transcribe: call.transcribe });
      // `file` may be a library video's asset id rather than a path.
      const asset = q.getAsset(call.file);
      return importProjectMedia(projectId, call.expectedRevision, asset?.kind === "video" ? { assetId: asset.id } : { file: call.file }, call.place, { transcribe: call.transcribe });
    }
    case "project.edit": return editProject(projectId, { expectedRevision: call.expectedRevision, operations: call.operations }, { actor: "agent" });
    case "assets.browseLocal": {
      const { browseLocalFolder } = await import("./local-assets");
      return browseLocalFolder(call.folder, call.offset, call.limit);
    }
    case "assets.importLocal": {
      const { importLocalAsset } = await import("./local-assets");
      return importLocalAsset(projectId, call.file);
    }
    case "assets.list": await scanLibrary(); return q.listAssets(call.kind, projectId);
    case "assets.delete": { const { removeLibraryAsset } = await import("../assets"); return removeLibraryAsset(call.id); }
    case "assets.capture": return captureAsset(projectId, call.atSec, call.mediaId);
    case "assets.search": return searchImages(call.query, 12, call.providers);
    case "assets.searchAudio": return searchAudio(call.query, 12, call.kind);
    case "assets.adoptAudio": {
      // Re-run the same search that produced the hit, the way a picture is adopted:
      // the id alone is not a URL we are willing to fetch on an agent's say-so.
      const hit = (await searchAudio(call.query, 12, call.kind)).find(h => h.id === call.id && h.provider === call.provider);
      if (!hit) throw new Error("Search result is no longer available. Search again before choosing a sound.");
      return adoptAudioHit(hit, projectId);
    }
    case "assets.providers": return listProviders();
    case "assets.importFolder": {
      const { importLocalFolder } = await import("./local-assets");
      return importLocalFolder(projectId, call.folder);
    }
    case "assets.adopt": {
      // Re-run the same search that produced the hit; a different provider set can rank it out of reach.
      const hit = (await searchImages(call.query, 12, call.providers)).find(h => h.id === call.id && h.provider === call.provider);
      if (!hit) throw new Error("Search result is no longer available. Search again before selecting an image.");
      return adoptHit(hit, projectId);
    }
    case "assets.upload": return uploadLibraryAsset(call.name, Buffer.from(call.base64, "base64"));
    case "assets.import": {
      const root = await fs.realpath(projectDir(projectId));
      const file = await fs.realpath(path.resolve(root, call.file));
      if (!file.startsWith(root + path.sep)) throw new Error("Import a file inside this project's workspace");
      return registerAsset({ file, scope: "project", projectId, source: "import" });
    }
    case "project.render": {
      const { renderProject } = await import("./render");
      return renderProject(projectId, { only: call.only, expectedRevision: call.expectedRevision,
        onProgress: (p) => report(p.stage === "bundling" ? "bundling composition" : `${p.stage === "done" ? "rendered" : "rendering"} ${p.title} (${p.index + 1}/${p.total})`, "stage") });
    }
    case "transcript.resync": {
      const { resyncTranscript } = await import("../transcribe/resync");
      return resyncTranscript(projectId, { expectedRevision: call.expectedRevision, brief: call.brief,
        onLog: (text) => report(text), onEvent: (e) => { if (e.kind !== "log") report(e.text.slice(0, 2000), e.kind); } });
    }
    case "templates.list": {
      const { listTemplates } = await import("../templates/registry");
      return listTemplates();
    }
    case "templates.schema": {
      const { templateSchema } = await import("../templates/registry");
      return templateSchema();
    }
    case "templates.get": {
      const { getTemplate } = await import("../templates/registry");
      return getTemplate(call.id);
    }
    case "templates.save": {
      const { saveTemplate, saveTemplateFrom } = await import("../templates/registry");
      // Either a whole template document, or a named variation of an existing one.
      if (call.from) {
        if (!call.id || !call.name) throw new Error("Saving a variation needs an id and a name.");
        return saveTemplateFrom(call.from, { id: call.id, name: call.name, author: call.author, overrides: call.overrides });
      }
      if (call.template === undefined) throw new Error("Provide a template document, or `from` with an id and a name.");
      return saveTemplate(call.template);
    }
    case "templates.delete": {
      const { deleteTemplate } = await import("../templates/registry");
      return deleteTemplate(call.id);
    }
    case "templates.looks": { const { listCaptionLooks } = await import("../templates/looks"); return listCaptionLooks(); }
    case "templates.preview": {
      const [{ getTemplate }, { templatePreviewSvg }, { aspectOf }] = await Promise.all([
        import("../templates/registry"), import("../templates/preview"), import("../templates/resolve"),
      ]);
      const sequence = call.sequenceId ? readEditor(projectId).edl.sequences.find((s) => s.id === call.sequenceId) : undefined;
      const aspect = call.aspect ?? (sequence ? aspectOf(sequence.output) : "9:16");
      return { svg: templatePreviewSvg(await getTemplate(call.id), aspect), aspect };
    }
    case "sequence.derive": {
      const { deriveSequence } = await import("./derive");
      const { tool, expectedRevision, ...request } = call; void tool;
      return deriveSequence(projectId, request, expectedRevision);
    }
    case "templates.suggest": {
      const { suggestTemplates } = await import("../templates/suggest");
      const { readEditor } = await import("./store");
      const { SlotValue } = await import("../templates/plan");
      const slots = Object.fromEntries(Object.entries(call.slots ?? {}).map(([id, value]) => [id, SlotValue.parse(value)]));
      return suggestTemplates(readEditor(projectId).edl, { sequenceId: call.sequenceId, clipId: call.clipId }, slots);
    }
    case "template.plan": {
      const { previewTemplate } = await import("../templates/apply");
      const { tool, ...request } = call; void tool;
      return previewTemplate(projectId, request);
    }
    case "template.apply": {
      const { applyTemplate } = await import("../templates/apply");
      const { tool, expectedRevision, ...request } = call; void tool;
      return applyTemplate(projectId, request, expectedRevision);
    }
    case "chat.source": { const { chatSource } = await import("../chat/comments"); return chatSource(); }
    case "chat.setSource": { const { saveChatSource } = await import("../chat/comments"); return saveChatSource(call.path); }
    case "comments.list": { const { listComments } = await import("../chat/place"); return listComments(projectId, call, call.limit); }
    case "comments.place": { const { placeComment } = await import("../chat/place"); return placeComment(projectId, call, "agent"); }
    // Rules, glossary and preferences: workspace level applies to every project, project
    // level to this one. Both interfaces read and write the same files through these.
    case "rules.list": { const { listRules } = await import("../rules/registry"); return listRules(projectId); }
    case "rules.get": { const { getRule } = await import("../rules/registry"); return getRule(call.id, projectId); }
    case "rules.schema": { const { ruleSchema } = await import("../rules/registry"); return ruleSchema(); }
    case "rules.save": { const { saveRule } = await import("../rules/registry"); return saveRule(call.rule, call.level, projectId); }
    case "rules.delete": { const { deleteRule } = await import("../rules/registry"); return deleteRule(call.id, call.level, projectId); }
    case "rules.evaluate": {
      const { evaluateRules } = await import("../rules/evaluate");
      // Judging rules is an agent run that is not a job, so it has to apply the
      // owner's harness and its task model here; `startJob` cannot do it for us.
      const { effectiveSelection } = await import("../agent/selection");
      return evaluateRules(projectId, { sequenceId: call.sequenceId, clipId: call.clipId }, { stage: call.stage, ...effectiveSelection(projectId, {}, "judging"), onEvent: (e) => { if (e.kind !== "log") report(e.text.slice(0, 2000), e.kind); } });
    }
    case "rules.apply": {
      const { applyRules } = await import("../rules/apply");
      const { tool, expectedRevision, ...request } = call; void tool;
      return applyRules(projectId, request, expectedRevision);
    }
    case "plan.read": {
      const { edl, revision } = readEditor(projectId);
      return { revision, project: edl.plan, sequences: edl.sequences.map((s) => ({ id: s.id, title: s.title, plan: s.plan })), clips: edl.clips.map((c) => ({ id: c.id, title: c.title, tags: c.tags })) };
    }
    case "plan.generate": {
      const { generateSequencePlan, generateProjectPlan } = await import("../plan/generate");
      const { effectiveSelection } = await import("../agent/selection");
      const watch = { ...effectiveSelection(projectId, {}, "planning"), onEvent: (e: { kind: string; text: string }) => { if (e.kind !== "log") report(e.text.slice(0, 2000), e.kind); } };
      return call.scope === "project" ? generateProjectPlan(projectId, watch) : generateSequencePlan(projectId, { sequenceId: call.sequenceId, clipId: call.clipId }, watch);
    }
    case "plan.apply": {
      const { applyPlan, applyProjectPlan } = await import("../plan/apply");
      const { tool, expectedRevision, all, ...request } = call; void tool;
      return all ? applyProjectPlan(projectId, expectedRevision, { slots: request.slots, providers: request.providers }) : applyPlan(projectId, request, expectedRevision);
    }
    case "media.transcribe": {
      if (call.background) {
        // Queue it and come straight back. With no ids this resumes whatever is
        // still waiting — what a project picks up again after a crash.
        const { startMediaTranscription } = await import("../transcribe/auto");
        const started = startMediaTranscription(projectId, { mediaIds: call.mediaIds, force: call.force, brief: call.brief, by: call.by ?? "" });
        if (started.queued.length) report(`transcribing ${started.queued.length} source${started.queued.length === 1 ? "" : "s"} in the background`, "tool");
        return started;
      }
      const { transcribeProjectMedia } = await import("../transcribe/media");
      return transcribeProjectMedia(projectId, { mediaIds: call.mediaIds, brief: call.brief, force: call.force,
        gate: call.force ? "always" : "audio", by: call.by ?? "",
        onLog: (text) => report(text), onEvent: (e) => { if (e.kind !== "log") report(e.text.slice(0, 2000), e.kind); } });
    }
    case "media.transcription": {
      const { transcribeSettings } = await import("../transcribe/settings");
      return { ...transcriptionState(projectId), settings: transcribeSettings(projectId) };
    }
    case "media.transcription.set": {
      const { saveTranscribeMode, transcribeSettings } = await import("../transcribe/settings");
      saveTranscribeMode(call.mode, call.level === "project" ? projectId : undefined);
      return transcribeSettings(projectId);
    }
    case "project.batch": {
      // A job, not a call: it runs for minutes and reports through the project's events.
      const { startJob } = await import("../jobs");
      return { job: startJob(projectId, "batch", { userBrief: call.brief, force: call.force }) };
    }
    case "observations.read": { const { readObservations } = await import("../observations"); return readObservations({ projectId: call.allProjects ? undefined : projectId, limit: call.limit }); }
    case "observations.review": {
      const { reviewObservations } = await import("../observations");
      const { effectiveSelection } = await import("../agent/selection");
      return reviewObservations(projectId, { ...effectiveSelection(projectId, {}, "observations"), onEvent: (e) => { if (e.kind !== "log") report(e.text.slice(0, 2000), e.kind); } });
    }
    case "packs.list": { const { listPacks } = await import("../packs"); return listPacks(); }
    case "packs.inspect": { const { inspectPack } = await import("../packs"); return inspectPack(call.source); }
    case "packs.import": { const { importPack } = await import("../packs"); return importPack(call.source, { replace: call.replace }); }
    case "packs.remove": { const { removePack } = await import("../packs"); return removePack(call.id); }
    case "packs.export": { const { exportPack } = await import("../packs"); const { tool, ...request } = call; void tool; return exportPack(request); }
    case "quickactions.list": { const { packQuickActions } = await import("../packs"); return packQuickActions(); }
    case "conversation.undo": { const { undoMessage } = await import("./conversation"); return undoMessage(projectId, call.messageId, call.expectedRevision); }
    case "conversation.read": { const { readConversation } = await import("./conversation"); return readConversation(projectId, call.limit); }
    case "glossary.get": { const { readGlossary } = await import("../glossary"); return readGlossary(projectId); }
    case "glossary.save": { const { saveGlossary } = await import("../glossary"); return saveGlossary(call.glossary, call.level, projectId); }
    case "preferences.get": { const { readPreferences } = await import("../preferences"); return readPreferences(projectId); }
    case "preferences.set": { const { savePreferences } = await import("../preferences"); return savePreferences(call.text, call.level, projectId); }
    case "onboarding.status": {
      const { onboardingState, ONBOARDING_QUESTIONS } = await import("../onboarding");
      const state = await onboardingState();
      return { ...state, questions: ONBOARDING_QUESTIONS, next: ONBOARDING_QUESTIONS.find((q) => state.remaining.includes(q.id)) ?? null };
    }
    case "onboarding.answer": { const { saveOnboardingAnswers } = await import("../onboarding"); return saveOnboardingAnswers(call.answers); }
    case "onboarding.run": {
      const { runOnboarding } = await import("../onboarding");
      const { effectiveSelection } = await import("../agent/selection");
      return runOnboarding(call.answers, effectiveSelection(undefined, {}, "observations"));
    }
    case "onboarding.skip": { const { skipOnboarding } = await import("../onboarding"); return skipOnboarding(); }
    case "onboarding.reopen": { const { reopenOnboarding } = await import("../onboarding"); return reopenOnboarding(); }
    case "agents.status": {
      const { detectHarnesses } = await import("../agent/detect");
      const { selectionOverview } = await import("../agent/selection");
      const known = q.getProject(projectId) ? projectId : undefined;
      return { harnesses: await detectHarnesses(), ...selectionOverview(known) };
    }
    case "agents.select": {
      const { applySelection, selectionOverview } = await import("../agent/selection");
      applySelection({ scope: call.scope, task: call.task, projectId, provider: call.provider, model: call.model });
      return selectionOverview(q.getProject(projectId) ? projectId : undefined);
    }
    // Write-only on purpose: `providerkeys.list` answers whether a key is set and
    // where it came from, never what it is. Nothing here may put a key in a reply,
    // an event line or a run directory.
    case "providerkeys.list": { const { providerKeys } = await import("../secrets"); return providerKeys(); }
    case "providerkeys.set": { const { setProviderKey } = await import("../secrets"); return setProviderKey(call.id, call.value); }
  }
}

/**
 * The project as a waiting caller needs it: what it is doing, how far along, and
 * every line logged since the cursor they last saw. The same answer feeds the web
 * panel's live feed and a terminal agent polling between its own turns.
 */
/** Never throws: a project with no EDL yet simply has no sources to report on. */
function transcriptionSummary(projectId: string) {
  try {
    // Synchronous on purpose: projectStatus is a plain read every surface polls.
    const state = transcriptionState(projectId);
    return { mode: state.mode.mode, media: state.media, pending: state.media.filter((m) => m.status === "running" || m.status === "queued").length };
  } catch { return { mode: "audio", media: [], pending: 0 }; }
}

export function projectStatus(projectId: string, since = 0, limit = 50) {
  // An agent polling between turns is the one interface that would otherwise wait
  // forever on a job whose process is gone.
  reapDeadJobs(projectId);
  const project = q.getProject(projectId);
  if (!project) throw new Error("Project not found");
  const rows = q.eventsSince(projectId, since);
  const activity = rows.slice(-limit).map((e) => ({ id: e.id, kind: e.kind, name: e.name, text: e.text, at: e.at }));
  const job = jobState(q.latestJob(projectId));
  let revision = project.revision;
  try { revision = readEditor(projectId).revision; } catch { /* a project without an EDL still has a status */ }
  return {
    status: project.status,
    error: project.error,
    revision,
    job,
    working: JOB_ACTIVE(job),
    /**
     * Where each source's words stand, alongside the job. It is here rather than
     * only in the EDL because this is what a waiting interface polls, and "the
     * transcript is still coming" is exactly the thing neither a person nor an
     * agent should have to infer from an empty `words` array.
     */
    transcription: transcriptionSummary(projectId),
    activity,
    /** Pass back as `since` to get only what is new. */
    cursor: rows.length ? rows[rows.length - 1].id : since,
  };
}
