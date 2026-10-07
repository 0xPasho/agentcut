import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db, q } from "../../../common/server/db";
import { projectDir } from "../../../common/server/config";
import { resolveProvider, type AgentEvent, type AgentProvider } from "../../agent/server/providers";
import type { Edl, Edit } from "../../editor/types";
import type { EditorOperation } from "../../editor/lib/operations";
import { isGeneratedAuthor, describeAuthor } from "../../editor/lib/authorship";
import { Rule } from "../types";
import { GlossaryTerm } from "./glossary";
import { AGENT_FILE_TOOLS, AGENT_SANDBOX_TOOLS } from "../../agent/data";

/**
 * The observation bank: what the owner corrected, one line each, written without
 * asking. A correction is a change to something an agent, rule or template placed,
 * or a caption text fix. Work created from scratch is not a correction. Every agent
 * reads the recent lines as soft context; turning them into rules or glossary
 * entries happens only when the owner asks ("review my preferences"), and then the
 * agent proposes and the owner accepts.
 */

export type Observation = { id: number; projectId: string; sequenceId: string | null; kind: string; text: string; by: string; at: number };

db.exec(`CREATE TABLE IF NOT EXISTS observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT NOT NULL, sequence_id TEXT, kind TEXT NOT NULL, text TEXT NOT NULL, by TEXT NOT NULL DEFAULT '', at INTEGER NOT NULL
); CREATE INDEX IF NOT EXISTS observations_at ON observations(at);`);

const rowToObservation = (r: Record<string, unknown>): Observation => ({ id: Number(r.id), projectId: String(r.project_id), sequenceId: (r.sequence_id as string | null) ?? null, kind: String(r.kind), text: String(r.text), by: String(r.by), at: Number(r.at) });

export function recordObservation(o: Omit<Observation, "id" | "at">): Observation {
  const at = Date.now();
  const id = Number(db.prepare("INSERT INTO observations (project_id, sequence_id, kind, text, by, at) VALUES (?, ?, ?, ?, ?, ?)").run(o.projectId, o.sequenceId, o.kind, o.text, o.by, at).lastInsertRowid);
  return { id, at, ...o };
}

/** Newest last. Across every project by default: preferences are the owner's, not a project's. */
export function readObservations(options: { projectId?: string; limit?: number } = {}): Observation[] {
  const limit = options.limit ?? 100;
  const rows = options.projectId
    ? db.prepare("SELECT * FROM (SELECT * FROM observations WHERE project_id = ? ORDER BY id DESC LIMIT ?) ORDER BY id").all(options.projectId, limit)
    : db.prepare("SELECT * FROM (SELECT * FROM observations ORDER BY id DESC LIMIT ?) ORDER BY id").all(limit);
  return rows.map((r) => rowToObservation({ ...(r as object) } as Record<string, unknown>));
}

export function clearObservations(projectId?: string) {
  if (projectId) db.prepare("DELETE FROM observations WHERE project_id = ?").run(projectId);
  else db.prepare("DELETE FROM observations").run();
}

const LABELS: Record<string, string> = { image: "picture", music: "music", sfx: "sound", silence: "silence cut", punch: "punch-in", emphasis: "emphasis" };
const label = (edit: Edit) => edit.type === "text" ? `title "${edit.text}"` : LABELS[edit.type] ?? (edit as { type: string }).type;
const key = (e: Edit) => JSON.stringify(e);

/** What a set of human operations changed about generated work. Pure; called by the store after a human commit. */
export function observeHumanEdit(projectId: string, before: Edl, operations: EditorOperation[]): Array<Omit<Observation, "id" | "at">> {
  const out: Array<Omit<Observation, "id" | "at">> = [];
  const push = (sequenceId: string | null, kind: string, text: string, by: string) => { if (out.length < 20) out.push({ projectId, sequenceId, kind, text, by }); };
  const clipOf = (op: { sequenceId?: string; itemId?: string; clipId?: string }) => {
    if ("clipId" in op && op.clipId) { const c = before.clips.find((x) => x.id === op.clipId); return c ? { clip: c, sequenceId: null as string | null } : null; }
    const s = before.sequences.find((x) => x.id === op.sequenceId); const i = s?.items.find((x) => x.id === op.itemId);
    return i ? { clip: i.clip, sequenceId: s!.id } : null;
  };
  for (const op of operations) {
    if (op.type === "item.patch" || op.type === "clip.patch") {
      const found = clipOf(op); if (!found) continue;
      const { clip, sequenceId } = found;
      if (op.patch.edits) {
        const after = new Set(op.patch.edits.map(key));
        for (const edit of clip.edits) {
          if (!isGeneratedAuthor(edit.by) || after.has(key(edit))) continue;
          const survivor = op.patch.edits.find((e) => e.type === edit.type && e.by === edit.by && Math.abs(e.t - edit.t) < 0.01);
          push(sequenceId, survivor ? "changed" : "removed", `${survivor ? "Changed" : "Removed"} the ${label(edit)} on "${clip.title}" (${describeAuthor(edit.by).toLowerCase()})`, edit.by);
        }
      }
      if (op.patch.words) {
        const changed = clip.words.map((w, i) => [w.w, op.patch.words![i]?.w] as const).filter(([a, b]) => b !== undefined && a !== b).slice(0, 5);
        if (changed.length) push(sequenceId, "caption", `Corrected captions on "${clip.title}": ${changed.map(([a, b]) => `${a} → ${b}`).join(", ")}`, "");
      }
      if (op.patch.captions && Object.keys(op.patch.captions).length && clip.edits.some((e) => isGeneratedAuthor(e.by))) {
        push(sequenceId, "captions", `Changed caption style on "${clip.title}": ${Object.entries(op.patch.captions).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(", ")}`, "");
      }
      // Framing is a property a template rewrites on every apply, so a person who keeps
      // correcting it is correcting the template — which is the one thing the bank is
      // for, and the one correction it could not see.
      if (op.patch.layout && clip.edits.some((e) => isGeneratedAuthor(e.by))) {
        const was = clip.layout;
        const now = op.patch.layout;
        const said = was.type === "split" && now.type === "split" && was.topPct !== now.topPct
          ? `the seam moved from ${was.topPct}% to ${now.topPct}%`
          : was.type !== now.type ? `${was.type} became ${now.type}` : "the rectangles moved";
        push(sequenceId, "framing", `Reframed "${clip.title}": ${said}`, "");
      }
    }
    if (op.type === "edit.remove" || op.type === "edit.replace") {
      const found = clipOf(op); const edit = found?.clip.edits[op.index];
      if (edit && isGeneratedAuthor(edit.by)) push(null, op.type === "edit.remove" ? "removed" : "changed", `${op.type === "edit.remove" ? "Removed" : "Changed"} the ${label(edit)} on "${found!.clip.title}" (${describeAuthor(edit.by).toLowerCase()})`, edit.by);
    }
    if (op.type === "item.remove") {
      const found = clipOf(op);
      const by = found?.clip.edits.find((e) => isGeneratedAuthor(e.by))?.by;
      if (found && by && found.clip.edits.every((e) => isGeneratedAuthor(e.by))) push(found.sequenceId, "removed", `Removed "${found.clip.title}" (${describeAuthor(by).toLowerCase()})`, by);
    }
    if (op.type === "item.keyframes") {
      const found = clipOf(op);
      // The mark is on the keyframes being replaced, not on the clip's edits: a move the
      // agent placed is the generated work here, whatever else is on the shot.
      const previous = before.sequences.find((s) => s.id === op.sequenceId)?.items.find((i) => i.id === op.itemId)?.keyframes ?? [];
      const by = previous.find((k) => isGeneratedAuthor(k.by))?.by;
      if (found && by) push(found.sequenceId, op.keyframes?.length ? "moved" : "removed",
        `${op.keyframes?.length ? "Changed" : "Removed"} the motion on "${found.clip.title}" (${describeAuthor(by).toLowerCase()})`, by);
    }
    if (op.type === "item.place") {
      const found = clipOf(op);
      const by = found?.clip.edits.find((e) => isGeneratedAuthor(e.by))?.by;
      if (found && by && (op.patch.transform || op.patch.at !== undefined)) push(found.sequenceId, "moved", `Moved or resized "${found.clip.title}" (${describeAuthor(by).toLowerCase()})`, by);
      if (found && by && (op.patch.volume !== undefined || op.patch.muted !== undefined)) push(found.sequenceId, "audio", `Changed the volume of "${found.clip.title}" (${describeAuthor(by).toLowerCase()})`, by);
    }
  }
  return out;
}

/** One block for a prompt: the recent corrections, newest last. Empty when there are none. */
export function observationsBlock(observations: Observation[]): string {
  if (!observations.length) return "";
  return `## What the owner has corrected before\nSoft evidence of taste, newest last. Do not repeat a mistake they undid.\n${observations.slice(-40).map((o) => `- ${o.text}`).join("\n")}`;
}

const Proposals = z.object({
  rules: z.array(Rule).default([]),
  glossary: z.array(GlossaryTerm).default([]),
  preferences: z.string().default(""),
  notes: z.string().default(""),
});
export type Proposals = z.infer<typeof Proposals> & { observations: number };

/** On request only: an agent reads the bank and proposes rules, glossary entries and preference lines. Nothing is saved here. */
export async function reviewObservations(projectId: string | undefined, o: { runner?: AgentProvider; provider?: string; model?: string; onEvent?: (e: AgentEvent) => void } = {}): Promise<Proposals> {
  const observations = readObservations({ limit: 200 });
  if (!observations.length) return { rules: [], glossary: [], preferences: "", notes: "Nothing has been corrected yet.", observations: 0 };
  const [{ listRules, ruleSchema }, { readGlossary }, { readPreferences }, { listTemplates }] = await Promise.all([import("./registry"), import("./glossary"), import("./preferences"), import("../../templates/server/registry")]);
  const base = projectId ? projectDir(projectId) : path.join(process.env.AGENTCUT_WORKSPACE ?? projectDir("_workspace"), "..");
  const dir = path.join(projectId ? base : projectDir("_workspace"), "review-runs", randomUUID());
  await fs.mkdir(dir, { recursive: true });
  await Promise.all([
    fs.writeFile(path.join(dir, "observations.json"), JSON.stringify(observations.map((x) => ({ at: new Date(x.at).toISOString(), text: x.text, kind: x.kind })), null, 2)),
    fs.writeFile(path.join(dir, "rules.json"), JSON.stringify(await listRules(projectId), null, 2)),
    fs.writeFile(path.join(dir, "rule.schema.json"), JSON.stringify(ruleSchema(), null, 2)),
    fs.writeFile(path.join(dir, "glossary.json"), JSON.stringify(await readGlossary(projectId), null, 2)),
    fs.writeFile(path.join(dir, "preferences.md"), (await readPreferences(projectId)).workspace),
    fs.writeFile(path.join(dir, "templates.json"), JSON.stringify((await listTemplates()).map((t) => ({ id: t.id, name: t.name })), null, 2)),
  ]);
  const provider = o.runner ?? await resolveProvider(o.provider);
  await provider.run({
    cwd: dir, allowedTools: AGENT_FILE_TOOLS, deniedTools: AGENT_SANDBOX_TOOLS, model: o.model, onEvent: o.onEvent,
    prompt: [
      "You are reviewing what a video editor's owner has corrected over time, to propose standing preferences. Read observations.json (one line per correction, newest last), rules.json (rules that already exist), rule.schema.json, glossary.json and preferences.md.",
      "Propose only what the evidence repeats: a correction made once is taste, made three times is a rule. Never propose a rule that already exists. A spelling fixed more than once is a glossary entry. A habit that is not a condition (\"always short hooks\") is a preferences line.",
      "Write proposals.json as {\"rules\":[<rule documents matching rule.schema.json>],\"glossary\":[{\"term\":\"\",\"aliases\":[],\"note\":\"\"}],\"preferences\":\"<lines to append to preferences.md, or empty>\",\"notes\":\"<one line on what you saw>\"}. Empty arrays are a fine answer.",
      "When proposals.json is written, reply with just: DONE",
    ].join("\n\n"),
  });
  const raw = await fs.readFile(path.join(dir, "proposals.json"), "utf8").catch(() => null);
  if (!raw) throw new Error("The agent did not write proposals.json");
  const parsed = Proposals.parse(JSON.parse(raw));
  const existing = new Set((await listRules(projectId)).map((r) => r.id));
  return { ...parsed, rules: parsed.rules.filter((r) => !existing.has(r.id)), observations: observations.length };
}
