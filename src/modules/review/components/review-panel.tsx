"use client";
import { useCallback, useEffect, useState } from "react";
import { CircleAlert, CircleCheck, CircleHelp, Loader2, ShieldCheck, Undo2 } from "lucide-react";
import { api } from "@/common/api/client";
import { Button } from "@/common/ui/button";
import { Input } from "@/common/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/common/ui/select";
import { Separator } from "@/common/ui/separator";
import type { Criteria } from "../server/criteria";
import type { CheckResult, Finding, ReviewArtifact, RubricResult, Severity } from "../types";

/**
 * What this video is held to, and what came of it.
 *
 * Every control here calls the tool the agent calls — `review.run`, `review.waive`,
 * `review.severity` — so the standard has one implementation and two ways in. A finding
 * is never hidden: waiving one keeps it on the list with the reason beside it, because
 * the reason is the part worth reading later.
 */

const RANK: Record<Severity, number> = { nitpick: 0, suggestion: 1, critical: 2 };
const SEVERITIES: Severity[] = ["critical", "suggestion", "nitpick"];

const asFinding = (c: CheckResult): Finding => ({
  id: c.id, severity: c.severity, ok: c.ok, waived: c.waived, fix: c.fix,
  said: `${c.metric} is ${typeof c.value === "number" ? c.value : c.value ? "yes" : "no"}`,
  detail: `asks for ${c.limit}`,
});
const asRubric = (r: RubricResult): Finding => ({
  id: r.id, severity: r.severity, ok: r.ok, waived: r.waived, fix: r.fix,
  said: r.ask,
  detail: r.verdict === "cannot-tell" ? `could not be told${r.note ? `: ${r.note}` : ""}` : `${r.note || r.verdict}${r.evidence ? ` — ${r.evidence}` : ""}`,
});

export function ReviewPanel({ projectId, sequenceId, afterChange }: {
  projectId: string;
  sequenceId?: string;
  afterChange?: () => Promise<void>;
}) {
  const [criteria, setCriteria] = useState<Criteria | null>(null);
  const [review, setReview] = useState<ReviewArtifact | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [waiving, setWaiving] = useState<{ id: string; reason: string } | null>(null);
  const [lowering, setLowering] = useState<{ id: string; severity: Severity; reason: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const [what, last] = await Promise.all([
        api.editorTool<Criteria>(projectId, { tool: "review.criteria", sequenceId }),
        api.editorTool<ReviewArtifact | null>(projectId, { tool: "review.read", sequenceId }),
      ]);
      setCriteria(what);
      setReview(Array.isArray(last) ? last[0] ?? null : last);
      setError("");
    } catch (reason) { setError((reason as Error).message); }
  }, [projectId, sequenceId]);
  useEffect(() => { void load(); }, [load]);

  const run = async (label: string, call: () => Promise<unknown>) => {
    setBusy(label); setError("");
    try { await call(); await load(); await afterChange?.(); }
    catch (reason) { setError((reason as Error).message); }
    finally { setBusy(""); }
  };

  if (!criteria) return <p className="text-xs text-muted-foreground">{error || "Reading the standard…"}</p>;

  const findings: Finding[] = review ? [...review.checks.map(asFinding), ...review.rubric.map(asRubric)] : [];
  const open = findings.filter((f) => !f.ok && !f.waived);
  const waived = findings.filter((f) => !f.ok && f.waived);
  const held = findings.filter((f) => f.ok);

  return (
    <div className="space-y-4 text-sm">
      {error && <p role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive">{error}</p>}

      <div className="space-y-1">
        <h3 className="flex items-center gap-2 font-medium"><ShieldCheck aria-hidden className="size-4" />What correct looks like here</h3>
        <p className="text-xs leading-relaxed text-muted-foreground">{criteria.reason}</p>
        <p className="text-xs text-muted-foreground">
          {criteria.checks.length} check{criteria.checks.length === 1 ? "" : "s"}
          {criteria.rubric.length ? ` and ${criteria.rubric.length} question${criteria.rubric.length === 1 ? "" : "s"} an agent answers` : ", and no questions"}.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={!!busy} onClick={() => void run("run", () => api.editorTool(projectId, { tool: "review.run", sequenceId }))}>
          {busy === "run" ? <Loader2 aria-hidden className="motion-safe:animate-spin" /> : <CircleCheck aria-hidden />}Check this video
        </Button>
        {!!criteria.rubric.length && (
          <Button size="sm" variant="outline" disabled={!!busy} onClick={() => void run("rubric", () => api.editorTool(projectId, { tool: "review.run", sequenceId, rubric: true }))}>
            {busy === "rubric" ? <Loader2 aria-hidden className="motion-safe:animate-spin" /> : <CircleHelp aria-hidden />}Ask the questions too
          </Button>
        )}
      </div>

      {!review && <p className="text-xs text-muted-foreground">This video has not been checked yet.</p>}
      {review && (
        <>
          <Verdict review={review} />
          {!!open.length && <Group title="To answer for" findings={open} busy={busy} asked={criteria}
            onWaive={(id) => setWaiving({ id, reason: "" })}
            waiving={waiving} setWaiving={setWaiving}
            lowering={lowering} setLowering={setLowering}
            onSeverity={(id, severity, reason) => run(`worth:${id}`, () => api.editorTool(projectId, { tool: "review.severity", id, severity, reason, sequenceId }).then(() => setLowering(null)))}
            onSave={(id, reason) => run(`waive:${id}`, () => api.editorTool(projectId, { tool: "review.waive", id, reason, sequenceId }).then(() => setWaiving(null)))} />}
          {!!waived.length && <Group title="Let stand" findings={waived} busy={busy}
            onUnwaive={(id) => run(`unwaive:${id}`, () => api.editorTool(projectId, { tool: "review.unwaive", id, sequenceId }))} />}
          {!!held.length && (
            <>
              <Separator />
              <details className="group">
                <summary className="cursor-pointer text-xs text-muted-foreground">{held.length} it holds to</summary>
                <ul className="mt-2 space-y-1">
                  {held.map((f) => <li key={f.id} className="flex items-start gap-2 text-xs text-muted-foreground"><CircleCheck aria-hidden className="mt-0.5 size-3 shrink-0 text-emerald-500" /><span>{f.said} — {f.detail}</span></li>)}
                </ul>
              </details>
            </>
          )}
          {!!review.skipped.length && (
            <details>
              <summary className="cursor-pointer text-xs text-muted-foreground">{review.skipped.length} not read on this video</summary>
              <ul className="mt-2 space-y-1">
                {review.skipped.map((s) => <li key={s.id} className="text-xs text-muted-foreground"><span className="font-mono">{s.id}</span> — {s.why}</li>)}
              </ul>
            </details>
          )}
        </>
      )}
    </div>
  );
}

const VERDICTS: Record<ReviewArtifact["verdict"], { text: string; className: string }> = {
  passed: { text: "It holds to everything the pack asks for.", className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" },
  "passed-with-findings": { text: "Nothing blocking, and some things worth reading.", className: "border-amber-500/40 bg-amber-500/10 text-amber-300" },
  failed: { text: "Something critical is wrong, and an export is refused until it is answered.", className: "border-destructive/40 bg-destructive/10 text-destructive" },
  "not-reviewed": { text: "Nothing here could be read on this video.", className: "border-white/15 bg-white/5 text-muted-foreground" },
};

function Verdict({ review }: { review: ReviewArtifact }) {
  const look = VERDICTS[review.verdict];
  const read = review.stages.includes("export") ? "the project and the export" : "the project";
  return (
    <div className={`space-y-1 rounded-2xl border px-3 py-2 ${look.className}`}>
      <p className="text-sm">{look.text}</p>
      <p className="text-xs opacity-80">Read from {read}{review.stages.includes("rubric") ? ", with the questions answered" : ""}. {review.stale ?? ""}</p>
    </div>
  );
}

const MARK: Record<Severity, string> = { critical: "text-destructive", suggestion: "text-amber-400", nitpick: "text-muted-foreground" };

function Group({ title, findings, busy, asked, onWaive, onUnwaive, waiving, setWaiving, lowering, setLowering, onSeverity, onSave }: {
  title: string;
  findings: Finding[];
  busy: string;
  /** What the pack asks, so lowering a severity can be told from raising one. */
  asked?: Criteria;
  onWaive?: (id: string) => void;
  onUnwaive?: (id: string) => void;
  waiving?: { id: string; reason: string } | null;
  setWaiving?: (w: { id: string; reason: string } | null) => void;
  lowering?: { id: string; severity: Severity; reason: string } | null;
  setLowering?: (l: { id: string; severity: Severity; reason: string } | null) => void;
  onSeverity?: (id: string, severity: Severity, reason: string) => void;
  onSave?: (id: string, reason: string) => void;
}) {
  const packSeverity = (id: string): Severity | undefined =>
    asked?.checks.find((c) => c.id === id)?.severity ?? asked?.rubric.find((r) => r.id === id)?.severity;
  return (
    <section className="space-y-2">
      <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h4>
      <ul className="space-y-2">
        {findings.map((finding) => (
          <li key={finding.id} className="space-y-2 rounded-2xl border border-white/10 bg-black/20 p-3">
            <div className="flex items-start gap-2">
              <CircleAlert aria-hidden className={`mt-0.5 size-4 shrink-0 ${MARK[finding.severity]}`} />
              <div className="min-w-0 space-y-1">
                <p className="leading-snug">{finding.said}</p>
                <p className="text-xs text-muted-foreground">{finding.detail}</p>
                {finding.fix && <p className="text-xs leading-relaxed">{finding.fix}</p>}
                {finding.waived && <p className="text-xs text-muted-foreground">Let stand: {finding.waived}</p>}
              </div>
            </div>
            {onWaive && waiving?.id !== finding.id && (
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={!!busy} onClick={() => setWaiving?.({ id: finding.id, reason: "" })}>Let it stand…</Button>
                <Select value={finding.severity} onValueChange={(value) => {
                  const next = String(value) as Severity;
                  if (next === finding.severity) return;
                  const pack = packSeverity(finding.id) ?? finding.severity;
                  // Raising one is a free decision; lowering one takes a sentence, because
                  // a standard quietly turned down is the same as no standard.
                  if (RANK[next] < RANK[pack]) setLowering?.({ id: finding.id, severity: next, reason: "" });
                  else onSeverity?.(finding.id, next, "");
                }}>
                  <SelectTrigger size="sm" className="w-auto text-xs" aria-label={`What ${finding.id} is worth here`}><SelectValue /></SelectTrigger>
                  <SelectContent>{SEVERITIES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
            {lowering?.id === finding.id && (
              <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); if (lowering.reason.trim()) onSeverity?.(finding.id, lowering.severity, lowering.reason.trim()); }}>
                <Input autoFocus value={lowering.reason} onChange={(event) => setLowering?.({ ...lowering, reason: event.target.value })}
                  placeholder={`Why this is only a ${lowering.severity} here`} aria-label={`Why ${finding.id} is only a ${lowering.severity} here`} className="h-8 text-xs" />
                <Button type="submit" size="sm" className="h-8" disabled={!lowering.reason.trim() || busy === `worth:${finding.id}`}>
                  {busy === `worth:${finding.id}` ? <Loader2 aria-hidden className="motion-safe:animate-spin" /> : null}Save
                </Button>
                <Button type="button" size="sm" variant="ghost" className="h-8" onClick={() => setLowering?.(null)}>Cancel</Button>
              </form>
            )}
            {onWaive && waiving?.id === finding.id && (
              <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); if (waiving.reason.trim()) onSave?.(finding.id, waiving.reason.trim()); }}>
                <Input autoFocus value={waiving.reason} onChange={(event) => setWaiving?.({ id: finding.id, reason: event.target.value })}
                  placeholder="Why this one is allowed" aria-label={`Why ${finding.id} is allowed`} className="h-8 text-xs" />
                <Button type="submit" size="sm" className="h-8" disabled={!waiving.reason.trim() || busy === `waive:${finding.id}`}>
                  {busy === `waive:${finding.id}` ? <Loader2 aria-hidden className="motion-safe:animate-spin" /> : null}Save
                </Button>
                <Button type="button" size="sm" variant="ghost" className="h-8" onClick={() => setWaiving?.(null)}>Cancel</Button>
              </form>
            )}
            {onUnwaive && (
              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={!!busy} onClick={() => onUnwaive(finding.id)}>
                {busy === `unwaive:${finding.id}` ? <Loader2 aria-hidden className="motion-safe:animate-spin" /> : <Undo2 aria-hidden />}Hold it to this again
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
