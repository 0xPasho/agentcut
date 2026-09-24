"use client";
import { useCallback, useEffect, useId, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { api } from "@/common/api/client";
import { Button } from "@/common/ui/button";
import { Input } from "@/common/ui/input";
import { Label } from "@/common/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/common/ui/select";
import { Separator } from "@/common/ui/separator";
import type { Metric } from "../data";
import type { PackReview, ReviewCheck, RubricItem, Severity } from "../types";

/**
 * What a pack holds its videos to, edited by hand.
 *
 * The metric list is not a free text field on purpose: a pack picks from what this
 * machine can measure, which is the same list `review.catalogue` hands an agent and the
 * same list an import is linted against. Everything here calls `packs.review.get/set`.
 */

const SEVERITIES: Severity[] = ["critical", "suggestion", "nitpick"];
const emptyCheck = (): ReviewCheck => ({ id: "", metric: "", severity: "suggestion", fix: "", tags: [] });
const emptyItem = (): RubricItem => ({ id: "", ask: "", evidence: "timestamp", severity: "suggestion", fix: "", compare: "" });

export function ReviewEditor({ packId }: { packId: string }) {
  const id = useId();
  const [review, setReview] = useState<PackReview | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [check, setCheck] = useState<ReviewCheck>(emptyCheck());
  const [limit, setLimit] = useState("");
  const [item, setItem] = useState<RubricItem>(emptyItem());
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const [loaded, catalogue] = await Promise.all([
        api.workspace<{ review: PackReview; warnings: string[] }>({ action: "packs.review.get", id: packId }),
        api.workspace<Metric[]>({ action: "review.catalogue" }),
      ]);
      setReview(loaded.review);
      setWarnings(loaded.warnings);
      setMetrics(catalogue);
    } catch (reason) { setError((reason as Error).message); }
  }, [packId]);
  useEffect(() => { void load(); }, [load]);

  const save = async (label: string, next: PackReview) => {
    setBusy(label); setError("");
    try {
      const saved = await api.workspace<{ review: PackReview; warnings: string[] }>({ action: "packs.review.set", id: packId, review: next });
      setReview(saved.review);
      setWarnings(saved.warnings);
      return true;
    } catch (reason) { setError((reason as Error).message); return false; }
    finally { setBusy(""); }
  };

  if (!review) return <p className="flex items-center gap-2 text-xs text-muted-foreground">{error || <><Loader2 aria-hidden className="size-3 motion-safe:animate-spin" />Reading the standard…</>}</p>;

  const chosen = metrics.find((m) => m.name === check.metric);
  const addCheck = () => {
    const next = { ...check, id: check.id.trim() || check.metric.split(".").join("-") };
    if (chosen?.kind === "boolean") next.is = limit !== "false";
    else if (limit.startsWith("<")) next.max = Number(limit.slice(1).trim());
    else if (limit.startsWith(">")) next.min = Number(limit.slice(1).trim());
    void save("add-check", { ...review, checks: [...review.checks.filter((c) => c.id !== next.id), next] }).then((ok) => { if (ok) { setCheck(emptyCheck()); setLimit(""); } });
  };

  return (
    <div className="space-y-4 text-sm">
      {error && <p role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive">{error}</p>}
      <div className="space-y-1">
        <h4 className="text-sm font-medium">What correct looks like</h4>
        <p className="text-xs leading-relaxed text-muted-foreground">
          The part of the guide that can be checked. A check is one measurement this machine takes and the limit you hold it to; a question is one an agent answers with somewhere to look. Both travel with the pack.
        </p>
      </div>

      {!!warnings.length && (
        <ul className="space-y-1 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2">
          {warnings.map((warning) => <li key={warning} role="status" className="text-xs text-amber-300">{warning}</li>)}
        </ul>
      )}

      <div className="space-y-2">
        <Label>Checks</Label>
        {!review.checks.length && <p className="text-xs text-muted-foreground">None yet, so these videos are held to the built-in ones.</p>}
        <ul className="space-y-2">
          {review.checks.map((c) => (
            <li key={c.id} className="flex items-start justify-between gap-2 rounded-2xl border border-white/10 bg-black/20 p-3">
              <div className="min-w-0 space-y-1">
                <p className="font-mono text-xs">{c.metric} {c.is !== undefined ? `is ${c.is}` : [c.min !== undefined ? `≥ ${c.min}` : "", c.max !== undefined ? `≤ ${c.max}` : ""].filter(Boolean).join(", ")}</p>
                <p className="text-xs text-muted-foreground">{c.severity}{c.tags.length ? ` · only ${c.tags.join(", ")}` : ""}{c.fix ? ` — ${c.fix}` : ""}</p>
              </div>
              <Button size="sm" variant="ghost" aria-label={`Remove ${c.id}`} disabled={!!busy} onClick={() => void save(`rm:${c.id}`, { ...review, checks: review.checks.filter((x) => x.id !== c.id) })}><Trash2 aria-hidden /></Button>
            </li>
          ))}
        </ul>
        <div className="grid gap-2 rounded-2xl border border-white/10 p-3 sm:grid-cols-2">
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor={`${id}-metric`} className="text-xs">Measurement</Label>
            <Select value={check.metric} onValueChange={(v) => setCheck({ ...check, metric: String(v) })}>
              <SelectTrigger id={`${id}-metric`} className="w-full"><SelectValue placeholder="Pick what to measure" /></SelectTrigger>
              <SelectContent>
                {metrics.map((m) => <SelectItem key={m.name} value={m.name}>{m.name}{m.unit ? ` (${m.unit})` : ""}</SelectItem>)}
              </SelectContent>
            </Select>
            {chosen && <p className="text-xs text-muted-foreground">{chosen.what} {chosen.stage === "export" ? "Read from the export, so it needs a render." : "Read from the project."}</p>}
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${id}-limit`} className="text-xs">{chosen?.kind === "boolean" ? "Must be" : "Limit"}</Label>
            {chosen?.kind === "boolean" ? (
              <Select value={limit || "true"} onValueChange={(v) => setLimit(String(v))}>
                <SelectTrigger id={`${id}-limit`} className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="true">yes</SelectItem><SelectItem value="false">no</SelectItem></SelectContent>
              </Select>
            ) : (
              <Input id={`${id}-limit`} value={limit} onChange={(event) => setLimit(event.target.value)} placeholder="< 62  or  > 5" />
            )}
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${id}-severity`} className="text-xs">Worth</Label>
            <Select value={check.severity} onValueChange={(v) => setCheck({ ...check, severity: v as Severity })}>
              <SelectTrigger id={`${id}-severity`} className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>{SEVERITIES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor={`${id}-fix`} className="text-xs">What to do about it</Label>
            <Input id={`${id}-fix`} value={check.fix} onChange={(event) => setCheck({ ...check, fix: event.target.value })} placeholder="Cut after the last sentence; the tag runs long." />
          </div>
          <Button size="sm" className="sm:col-span-2" disabled={!!busy || !check.metric || (chosen?.kind !== "boolean" && !limit.trim())} onClick={addCheck}>
            {busy === "add-check" ? <Loader2 aria-hidden className="motion-safe:animate-spin" /> : <Plus aria-hidden />}Add this check
          </Button>
        </div>
      </div>

      <Separator />

      <div className="space-y-2">
        <Label>Questions</Label>
        <p className="text-xs text-muted-foreground">For what no number catches. An answer has to point at something, or it is recorded as “cannot tell”.</p>
        <ul className="space-y-2">
          {review.rubric.map((r) => (
            <li key={r.id} className="flex items-start justify-between gap-2 rounded-2xl border border-white/10 bg-black/20 p-3">
              <div className="min-w-0 space-y-1">
                <p className="leading-snug">{r.ask}</p>
                <p className="text-xs text-muted-foreground">{r.severity} · answered with a {r.evidence}{r.compare ? ` · against ${r.compare}` : ""}</p>
              </div>
              <Button size="sm" variant="ghost" aria-label={`Remove ${r.id}`} disabled={!!busy} onClick={() => void save(`rm:${r.id}`, { ...review, rubric: review.rubric.filter((x) => x.id !== r.id) })}><Trash2 aria-hidden /></Button>
            </li>
          ))}
        </ul>
        <div className="grid gap-2 rounded-2xl border border-white/10 p-3 sm:grid-cols-2">
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor={`${id}-ask`} className="text-xs">The question</Label>
            <Input id={`${id}-ask`} value={item.ask} onChange={(event) => setItem({ ...item, ask: event.target.value })} placeholder="Does the clip open on the comment being answered?" />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${id}-evidence`} className="text-xs">Answered with</Label>
            <Select value={item.evidence} onValueChange={(v) => setItem({ ...item, evidence: v as RubricItem["evidence"] })}>
              <SelectTrigger id={`${id}-evidence`} className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="timestamp">a timestamp</SelectItem>
                <SelectItem value="frame">a frame</SelectItem>
                <SelectItem value="field">a field of the video</SelectItem>
                <SelectItem value="quote">a quote</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${id}-qseverity`} className="text-xs">Worth</Label>
            <Select value={item.severity} onValueChange={(v) => setItem({ ...item, severity: v as Severity })}>
              <SelectTrigger id={`${id}-qseverity`} className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>{SEVERITIES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor={`${id}-qfix`} className="text-xs">What to do about it</Label>
            <Input id={`${id}-qfix`} value={item.fix} onChange={(event) => setItem({ ...item, fix: event.target.value })} placeholder="Extend the head to the comment." />
          </div>
          <Button size="sm" className="sm:col-span-2" disabled={!!busy || !item.ask.trim()}
            onClick={() => {
              const next = { ...item, id: item.id.trim() || slug(item.ask) };
              void save("add-question", { ...review, rubric: [...review.rubric.filter((r) => r.id !== next.id), next] }).then((ok) => { if (ok) setItem(emptyItem()); });
            }}>
            {busy === "add-question" ? <Loader2 aria-hidden className="motion-safe:animate-spin" /> : <Plus aria-hidden />}Add this question
          </Button>
        </div>
      </div>
    </div>
  );
}

const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").split("-").slice(0, 4).join("-") || "question";
