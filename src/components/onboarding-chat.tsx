"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Loader2, Sparkles } from "lucide-react";
import { api, type OnboardingQuestion, type OnboardingState } from "@/lib/client";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";

/**
 * The same interview, asked by the agent instead of by a form: one question above
 * the composer, answered in passing while editing. It writes through the same
 * functions as /welcome — same answers, same preferences section, same state — so a
 * question answered here is gone from the full-screen flow and the other way round.
 *
 * It is never a gate. The composer underneath keeps working while this is open,
 * "Not now" ends it for good, and passing on one question just moves to the next.
 */
export function OnboardingChat() {
  const [state, setState] = useState<OnboardingState | null>(null);
  /** Questions waved off in this session. Not saved: a skip here is not a decision. */
  const [passed, setPassed] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [written, setWritten] = useState(false);

  useEffect(() => {
    api.workspace<OnboardingState>({ action: "onboarding.status" }).then(setState).catch(() => setState(null));
  }, []);

  const questions: readonly OnboardingQuestion[] = state?.questions ?? [];
  const asking = useMemo(
    () => questions.find((q) => (state?.remaining ?? []).includes(q.id) && !passed.includes(q.id)) ?? null,
    [questions, state, passed],
  );
  const answered = questions.length - (state?.remaining.length ?? questions.length);

  if (!state || state.status !== "pending" || state.hasPreferences) return null;
  if (written) return <p className="rounded-xl border border-border px-3 py-2 text-xs text-muted-foreground">Preferences written from your answers. They are in the Library, editable.</p>;

  const act = async (run: () => Promise<void>) => {
    setPending(true);
    try { await run(); } catch { /* offered again next time the panel loads */ }
    finally { setPending(false); }
  };

  const answer = () => act(async () => {
    if (!asking || !draft.trim()) return;
    setState(await api.workspace<OnboardingState>({ action: "onboarding.answer", answers: { [asking.id]: draft.trim() } }));
    setDraft("");
  });

  const finish = () => act(async () => { await api.workspace({ action: "onboarding.run" }); setWritten(true); });
  const stop = () => act(async () => { setState(await api.workspace<OnboardingState>({ action: "onboarding.skip" })); });

  return (
    <div className="space-y-2 rounded-xl border border-border p-3">
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Sparkles className="size-3.5 text-primary" aria-hidden />
        {asking ? "So I edit the way you want — answer whenever, it does not hold anything up." : answered ? "Enough to work with." : "No rush. I will ask again another time."}
      </p>
      {asking ? (
        <>
          <p className="text-sm font-medium">{asking.label}</p>
          <Textarea rows={2} value={draft} placeholder={asking.placeholder} disabled={pending}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); answer(); } }} />
          <div className="flex flex-wrap items-center gap-1.5">
            <Button size="xs" variant="outline" disabled={pending || !draft.trim()} onClick={answer}>{pending ? <Loader2 className="motion-safe:animate-spin" /> : null}Save</Button>
            <Button size="xs" variant="ghost" disabled={pending} onClick={() => { setDraft(""); setPassed([...passed, asking.id]); }}>Ask me later</Button>
            <Button size="xs" variant="ghost" disabled={pending} onClick={stop}>Not now</Button>
            <Button size="xs" variant="ghost" render={<Link href="/welcome" />}>Answer all of them</Button>
          </div>
        </>
      ) : (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground">{answered} of {questions.length} answered.</span>
          <Button size="xs" variant="outline" disabled={pending || !answered} onClick={finish}>{pending ? <Loader2 className="motion-safe:animate-spin" /> : <Sparkles />}Write my preferences</Button>
          <Button size="xs" variant="ghost" disabled={pending} onClick={stop}>Not now</Button>
        </div>
      )}
    </div>
  );
}
