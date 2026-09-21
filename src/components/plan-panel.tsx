"use client";
import { useId, useState, type ReactNode } from "react";
import { Loader2, Sparkles, Trash2, Wand2, X } from "lucide-react";
import { api } from "@/lib/client";
import type { Edl } from "@/lib/edl";
import type { EditorOperation } from "@/lib/editor/operations";
import type { Beat, BeatKind, SequenceStatus } from "@/lib/plan/schema";
import type { PlanApplyResult, ProjectApplyResult } from "@/lib/plan/apply";
import { sequenceFrames } from "@/lib/sequences";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Separator } from "./ui/separator";

/**
 * The plan is what the agent decided and why. This panel shows both levels and
 * lets a person change a decision; every change is a plan.patch or
 * sequence.plan.patch through the same dispatch as any timeline edit, so it is
 * saved, revisioned and undoable. Generating and applying call the same tools an
 * agent calls.
 */

const STATUS_LABELS: Record<SequenceStatus, string> = { pending: "Pending", edited: "Edited", approved: "Approved", rendered: "Rendered" };
const KIND_LABELS: Record<BeatKind, string> = { hook: "Hook", point: "Point", payoff: "Payoff", outro: "Outro", other: "Other" };
const NUMBERING: Record<string, string> = { none: "No numbering", "n-of-total": "Part n of N", n: "Part n" };
const tagsOf = (text: string) => [...new Set(text.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean))];

export function PlanPanel({ projectId, edl, sequenceId, templates, dispatch, seek, beforeRun, afterRun, children }: {
  projectId: string;
  edl: Edl;
  sequenceId: string;
  templates: Array<{ id: string; name: string }>;
  dispatch: (operations: EditorOperation[]) => boolean;
  seek: (outputSec: number) => void;
  /** Saves pending edits first; false means the run must not start. */
  beforeRun: () => Promise<boolean>;
  afterRun: () => Promise<void>;
  /** The template settings panel, folded under the plan. */
  children?: ReactNode;
}) {
  const id = useId();
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const sequence = edl.sequences.find((s) => s.id === sequenceId);
  const project = edl.plan;
  const plan = sequence?.plan;

  const run = async (label: string, call: () => Promise<string>) => {
    setBusy(label); setError(""); setMessage("");
    try {
      if (!(await beforeRun())) return;
      setMessage(await call());
      await afterRun();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(""); }
  };
  const revision = async () => (await api.getProject(projectId)).revision;
  const patchProject = (patch: Record<string, unknown>) => dispatch([{ type: "plan.patch", patch } as EditorOperation]);
  const patchSequence = (patch: Record<string, unknown>) => dispatch([{ type: "sequence.plan.patch", sequenceId, patch } as EditorOperation]);
  const describe = (r: PlanApplyResult) => r.applied
    ? `Applied ${r.templateId} with ${r.applied.images} picture${r.applied.images === 1 ? "" : "s"}${r.ignored.length ? `; unknown rules ${r.ignored.join(", ")}` : ""}.`
    : `Nothing to change.`;

  const beatSeek = (beat: Beat) => {
    if (!sequence) return;
    const resolved = sequenceFrames(sequence).items.find((entry) => entry.item.id === beat.itemIds[0]);
    if (!resolved) return;
    const offset = Math.max(0, (beat.atSec ?? resolved.item.clip.start) - resolved.item.clip.start);
    seek(resolved.from / sequence.output.fps + offset);
  };

  return (
    <div className="space-y-4">
      <section className="space-y-3" aria-labelledby={`${id}-project`}>
        <div className="flex items-center gap-2">
          <h3 id={`${id}-project`} className="flex-1 text-sm font-medium">Every video in this project</h3>
          <Button size="xs" variant="outline" disabled={!!busy} onClick={() => run("project", async () => { await api.editorTool(projectId, { tool: "plan.generate", scope: "project" }); return "The agent wrote the shared plan."; })}>
            {busy === "project" ? <Loader2 className="motion-safe:animate-spin" /> : <Sparkles />}Plan the set
          </Button>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="Goal" id={`${id}-goal`}><Input id={`${id}-goal`} value={project.brief.goal} placeholder="Tips series for new users" onChange={(e) => patchProject({ brief: { ...project.brief, goal: e.target.value } })} /></Field>
          <Field label="Platform" id={`${id}-platform`}><Input id={`${id}-platform`} value={project.brief.platform} placeholder="tiktok, shorts, reels" onChange={(e) => patchProject({ brief: { ...project.brief, platform: e.target.value } })} /></Field>
          <Field label="Target length (s)" id={`${id}-length`}><Input id={`${id}-length`} type="number" min={1} value={project.brief.lengthSec ?? ""} onChange={(e) => patchProject({ brief: { ...project.brief, lengthSec: e.target.value === "" ? null : Number(e.target.value) } })} /></Field>
          <Field label="Shared template" id={`${id}-template`}>
            <TemplateSelect id={`${id}-template`} value={project.template} templates={templates} empty="Decide per video" onChange={(v) => patchProject({ template: v })} />
          </Field>
          <Field label="Tags" id={`${id}-ptags`}><Input id={`${id}-ptags`} defaultValue={project.tags.join(", ")} placeholder="gameplay, tutorial" onBlur={(e) => patchProject({ tags: tagsOf(e.target.value) })} /></Field>
          <Field label="Series" id={`${id}-series`}>
            <Select value={project.series.enabled ? project.series.numbering : "off"} onValueChange={(v) => patchProject({ series: v === "off" ? { ...project.series, enabled: false } : { ...project.series, enabled: true, numbering: v } })}>
              <SelectTrigger id={`${id}-series`} className="w-full"><SelectValue>{(v: unknown) => v === "off" ? "Not a series" : NUMBERING[String(v)]}</SelectValue></SelectTrigger>
              <SelectContent><SelectItem value="off">Not a series</SelectItem>{Object.entries(NUMBERING).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
        </div>
        {/* A shortlist chosen on the home screen, or by the agent: the templates this
            project may use. Clicking one settles it for every video; the cross drops it. */}
        {project.templates.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Shortlist</span>
            {project.templates.map((templateId) => {
              const name = templates.find((t) => t.id === templateId)?.name ?? templateId;
              return (
                <span key={templateId} className={`flex items-center gap-0.5 rounded-full border py-0.5 pr-0.5 pl-2 text-xs ${project.template === templateId ? "border-primary/60 bg-primary/10" : "border-border bg-card/60"}`}>
                  <button type="button" title="Use this for every video" className="hover:underline" onClick={() => patchProject({ template: templateId })}>{name}</button>
                  <Button size="icon-sm" variant="ghost" aria-label={`Drop ${name} from the shortlist`} onClick={() => patchProject({ templates: project.templates.filter((kept) => kept !== templateId), ...(project.template === templateId ? { template: null } : {}) })}><X /></Button>
                </span>
              );
            })}
            {project.templates.length > 1 && !project.template && <span className="text-[11px] text-muted-foreground">Each video takes whichever of these suits it.</span>}
          </div>
        )}
        {!!Object.keys(project.reasons).length && <Reasons reasons={project.reasons} />}
        <Button size="sm" variant="outline" disabled={!!busy} onClick={() => run("all", async () => {
          const r = await api.editorTool<ProjectApplyResult>(projectId, { tool: "plan.apply", all: true, expectedRevision: await revision() });
          const failed = r.results.filter((x) => !x.ok);
          return `Applied to ${r.results.length - failed.length} of ${r.results.length} videos${failed.length ? `; failed: ${failed.map((x) => x.sequenceId).join(", ")}` : ""}.`;
        })}>{busy === "all" ? <Loader2 className="motion-safe:animate-spin" /> : <Wand2 />}Apply to every video</Button>
      </section>

      {sequence && plan && <>
        <Separator />
        <section className="space-y-3" aria-labelledby={`${id}-video`}>
          <div className="flex items-center gap-2">
            <h3 id={`${id}-video`} className="flex-1 text-sm font-medium">This video</h3>
            <Button size="xs" variant="outline" disabled={!!busy} onClick={() => run("sequence", async () => { await api.editorTool(projectId, { tool: "plan.generate", scope: "sequence", sequenceId }); return "The agent wrote this video's plan."; })}>
              {busy === "sequence" ? <Loader2 className="motion-safe:animate-spin" /> : <Sparkles />}Plan this video
            </Button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Status" id={`${id}-status`}>
              <Select value={plan.status} onValueChange={(v) => patchSequence({ status: v })}>
                <SelectTrigger id={`${id}-status`} className="w-full"><SelectValue>{(v: unknown) => STATUS_LABELS[v as SequenceStatus]}</SelectValue></SelectTrigger>
                <SelectContent>{Object.entries(STATUS_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Template for this video" id={`${id}-stemplate`}>
              <TemplateSelect id={`${id}-stemplate`} value={plan.template} templates={templates} empty={project.template ? `Same as the set (${templates.find((t) => t.id === project.template)?.name ?? project.template})` : "Whatever fits best"} onChange={(v) => patchSequence({ template: v })} />
            </Field>
            <Field label="Tags" id={`${id}-stags`}><Input id={`${id}-stags`} key={plan.tags.join(",")} defaultValue={plan.tags.join(", ")} placeholder="gameplay, tutorial" onBlur={(e) => patchSequence({ tags: tagsOf(e.target.value) })} /></Field>
            <Field label="What it says" id={`${id}-summary`}><Input id={`${id}-summary`} key={plan.summary} defaultValue={plan.summary} placeholder="One line" onBlur={(e) => patchSequence({ summary: e.target.value })} /></Field>
          </div>
          {!!plan.rules.length && <p className="text-xs text-muted-foreground">Rules: {plan.rules.join(", ")}</p>}
          {!!Object.keys(plan.reasons).length && <Reasons reasons={plan.reasons} />}
          <Beats beats={plan.beats} onSeek={beatSeek} onChange={(beats) => patchSequence({ beats })} />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={!!busy} onClick={() => run("apply", async () => describe(await api.editorTool<PlanApplyResult>(projectId, { tool: "plan.apply", sequenceId, expectedRevision: await revision() })))}>
              {busy === "apply" ? <Loader2 className="motion-safe:animate-spin" /> : <Wand2 />}Apply plan to this video
            </Button>
          </div>
        </section>
      </>}
      {children && <><Separator /><details><summary className="cursor-pointer text-sm font-medium">Template settings</summary><div className="mt-3">{children}</div></details></>}
      {message && <p role="status" className="text-xs text-muted-foreground">{message}</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

function Field({ label, id, children }: { label: string; id: string; children: ReactNode }) {
  return <div className="space-y-1"><Label htmlFor={id}>{label}</Label>{children}</div>;
}

function TemplateSelect({ id, value, templates, empty, onChange }: { id: string; value: string | null; templates: Array<{ id: string; name: string }>; empty: string; onChange: (v: string | null) => void }) {
  return (
    <Select value={value ?? ""} onValueChange={(v) => onChange(v ? String(v) : null)}>
      <SelectTrigger id={id} className="w-full"><SelectValue>{(v: unknown) => templates.find((t) => t.id === v)?.name ?? empty}</SelectValue></SelectTrigger>
      <SelectContent><SelectItem value="">{empty}</SelectItem>{templates.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
    </Select>
  );
}

function Reasons({ reasons }: { reasons: Record<string, string> }) {
  return <dl className="space-y-1 text-xs text-muted-foreground">{Object.entries(reasons).map(([k, v]) => <div key={k}><dt className="inline font-medium text-foreground">{k}: </dt><dd className="inline">{v}</dd></div>)}</dl>;
}

function Beats({ beats, onSeek, onChange }: { beats: Beat[]; onSeek: (beat: Beat) => void; onChange: (beats: Beat[]) => void }) {
  const [draft, setDraft] = useState<{ kind: BeatKind; intent: string }>({ kind: "point", intent: "" });
  if (!beats.length) return <p className="text-xs text-muted-foreground">No beats yet. Plan this video and the agent writes them, with a reason for each.</p>;
  return (
    <ol className="space-y-1.5">
      {beats.map((beat, i) => <li key={beat.id} className="rounded-xl border border-border p-2 text-sm">
        <div className="flex items-start gap-2">
          <Badge variant="secondary" className="shrink-0 text-[10px]">{KIND_LABELS[beat.kind]}</Badge>
          <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onSeek(beat)} title="Go to this beat">
            <span className="block truncate font-medium">{beat.intent || "(no intent)"}</span>
            {beat.reason && <span className="block text-xs text-muted-foreground">{beat.reason}</span>}
            {!beat.itemIds.length && <span className="block text-xs text-destructive">The shot this beat described is gone.</span>}
          </button>
          <Button size="icon-sm" variant="ghost" aria-label={`Remove beat ${i + 1}`} onClick={() => onChange(beats.filter((b) => b.id !== beat.id))}><Trash2 /></Button>
        </div>
        <details className="mt-1 text-xs"><summary className="cursor-pointer text-muted-foreground">Edit</summary>
          <div className="mt-2 grid gap-2 sm:grid-cols-[auto_1fr]">
            <Select value={beat.kind} onValueChange={(v) => onChange(beats.map((b) => b.id === beat.id ? { ...b, kind: v as BeatKind } : b))}>
              <SelectTrigger aria-label="Beat kind" className="w-28"><SelectValue>{(v: unknown) => KIND_LABELS[v as BeatKind]}</SelectValue></SelectTrigger>
              <SelectContent>{Object.entries(KIND_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
            </Select>
            <Input aria-label="Beat intent" key={beat.intent} defaultValue={beat.intent} onBlur={(e) => { if (e.target.value !== beat.intent) onChange(beats.map((b) => b.id === beat.id ? { ...b, intent: e.target.value } : b)); }} />
          </div>
        </details>
      </li>)}
      <li className="flex gap-2">
        <Select value={draft.kind} onValueChange={(v) => setDraft({ ...draft, kind: v as BeatKind })}>
          <SelectTrigger aria-label="New beat kind" className="w-28"><SelectValue>{(v: unknown) => KIND_LABELS[v as BeatKind]}</SelectValue></SelectTrigger>
          <SelectContent>{Object.entries(KIND_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
        </Select>
        <Input aria-label="New beat intent" placeholder="Add a beat" value={draft.intent} onChange={(e) => setDraft({ ...draft, intent: e.target.value })} />
        <Button size="sm" variant="outline" disabled={!draft.intent.trim()} onClick={() => { onChange([...beats, { id: `b_${crypto.randomUUID().slice(0, 8)}`, kind: draft.kind, intent: draft.intent.trim(), reason: "added by hand", itemIds: beats[0]?.itemIds ?? [] }]); setDraft({ kind: "point", intent: "" }); }}>Add</Button>
      </li>
    </ol>
  );
}
