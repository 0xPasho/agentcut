"use client";
import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, Loader2, Sparkles } from "lucide-react";
import { api, type OnboardingQuestion, type OnboardingState } from "@/common/api/client";
import { Button } from "../../common/ui/button";
import { Label } from "../../common/ui/label";
import { Textarea } from "../../common/ui/textarea";

/**
 * The interview, full screen and on its own route. It is here rather than on the
 * home page because it is a different job from making a video: answering it needs
 * the whole screen and no competing call to action, and having a route means it can
 * be left, linked and returned to instead of being a card that disappears forever.
 *
 * One question per step. Only the first is worth insisting on — with nothing there
 * is nothing to write — and even that one never blocks: "Skip for now" is on every
 * step, Esc does the same, and the answers already typed are kept either way.
 */
export function Welcome({ questions, initial }: { questions: readonly OnboardingQuestion[]; initial: OnboardingState }) {
  const id = useId();
  const router = useRouter();
  const [answers, setAnswers] = useState<Record<string, string>>({ ...initial.answers });
  const [step, setStep] = useState(0);
  const [phase, setPhase] = useState<"asking" | "writing" | "review">("asking");
  const [progress, setProgress] = useState<string[]>([]);
  const [written, setWritten] = useState("");
  const [glossary, setGlossary] = useState<string[]>([]);
  const [pending, setPending] = useState<"" | "skip" | "save">("");
  const [error, setError] = useState("");
  const field = useRef<HTMLTextAreaElement>(null);

  const question = questions[step];
  const value = answers[question?.id ?? ""] ?? "";
  const last = step === questions.length - 1;
  const blocked = !!question?.required && !value.trim();

  useEffect(() => { field.current?.focus(); }, [step]);

  /** Keep every answer as it is given: leaving mid-interview must lose nothing. */
  const remember = (next: Record<string, string>) =>
    api.workspace({ action: "onboarding.answer", answers: next }).catch(() => { /* saved again on finish */ });

  const skip = async () => {
    setPending("skip"); setError("");
    try {
      // Save before skipping, not alongside it: what was typed is kept for the day
      // they come back, and the skip is the last word on the state.
      await remember(answers);
      await api.workspace({ action: "onboarding.skip" });
      router.push("/"); router.refresh();
    } catch (e) { setError((e as Error).message); setPending(""); }
  };

  const advance = () => {
    if (blocked) return;
    void remember(answers);
    if (!last) { setStep(step + 1); return; }
    void write();
  };

  const write = async () => {
    setPhase("writing"); setProgress([]); setError("");
    try {
      const result = await api.runOnboarding(answers, (line) => setProgress((p) => [...p.slice(-2), line]));
      setWritten(result.preferences);
      setGlossary(result.glossary.map((g) => g.term));
      setPhase("review");
    } catch (e) { setError((e as Error).message); setPhase("asking"); }
  };

  const save = async () => {
    setPending("save"); setError("");
    try {
      await api.workspace({ action: "preferences.set", text: written });
      router.push("/"); router.refresh();
    } catch (e) { setError((e as Error).message); setPending(""); }
  };

  return (
    <main
      className="flex min-h-screen w-full flex-col px-4 py-6 sm:px-8"
      onKeyDown={(e) => { if (e.key === "Escape" && phase === "asking" && !pending) { e.preventDefault(); void skip(); } }}
    >
      <header className="mx-auto flex w-full max-w-2xl items-center gap-3">
        <span className="text-sm font-medium tracking-tight">agentcut</span>
        <span className="text-xs text-muted-foreground">setup</span>
        <Button variant="ghost" size="sm" className="ml-auto" disabled={!!pending || phase === "writing"} onClick={() => void skip()}>
          {pending === "skip" ? <Loader2 className="motion-safe:animate-spin" /> : null}Skip for now
        </Button>
      </header>

      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-8 py-10">
        {phase === "asking" && question && (
          <>
            <Steps count={questions.length} step={step} />
            <div className="space-y-2">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Question {step + 1} of {questions.length}</p>
              <Label htmlFor={`${id}-${question.id}`} className="text-balance text-2xl font-semibold tracking-tight">{question.label}</Label>
              <p className="text-sm text-muted-foreground">
                {question.required
                  ? "The one answer worth giving. Everything else can stay empty."
                  : "Optional. Enter to continue, or leave it blank."}
              </p>
            </div>
            <Textarea
              ref={field}
              id={`${id}-${question.id}`}
              rows={3}
              placeholder={question.placeholder}
              value={value}
              onChange={(e) => setAnswers({ ...answers, [question.id]: e.target.value })}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); advance(); } }}
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button size="lg" disabled={blocked} onClick={advance}>
                {last ? <Sparkles /> : null}{last ? "Write my preferences" : "Continue"}{last ? null : <ArrowRight data-icon="inline-end" />}
              </Button>
              {step > 0 && <Button variant="ghost" size="lg" onClick={() => setStep(step - 1)}><ArrowLeft />Back</Button>}
              {!last && !blocked && <span className="text-xs text-muted-foreground">Enter to continue · Shift+Enter for a new line</span>}
              {blocked && <span className="text-xs text-muted-foreground">Answer this, or skip the whole thing.</span>}
            </div>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          </>
        )}

        {phase === "writing" && (
          <div className="space-y-3" aria-busy>
            <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight"><Loader2 className="size-5 motion-safe:animate-spin" />Writing your preferences</h1>
            <p className="text-sm text-muted-foreground">The agent is turning the answers into preferences it can follow. This takes a moment.</p>
            <ol className="space-y-1 text-xs text-muted-foreground" aria-live="polite">
              {progress.map((line, i) => <li key={i} className="truncate">{line}</li>)}
            </ol>
          </div>
        )}

        {phase === "review" && (
          <div className="space-y-4">
            <div className="space-y-1">
              <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight"><Check className="size-5 text-primary" />Preferences written</h1>
              <p className="text-sm text-muted-foreground">Edit anything that is not right. These go into every video, and settings keeps them editable.</p>
            </div>
            <Textarea rows={12} value={written} onChange={(e) => setWritten(e.target.value)} className="font-mono text-xs" />
            {!!glossary.length && <p className="text-xs text-muted-foreground">Names added to the glossary: {glossary.join(", ")}.</p>}
            <div className="flex flex-wrap items-center gap-2">
              <Button size="lg" disabled={!!pending} onClick={() => void save()}>{pending === "save" ? <Loader2 className="motion-safe:animate-spin" /> : <Check />}Save and start</Button>
              <Button variant="ghost" size="lg" disabled={!!pending} onClick={() => { setPhase("asking"); setStep(0); }}>Change an answer</Button>
            </div>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          </div>
        )}
      </div>

      <footer className="mx-auto w-full max-w-2xl text-xs text-muted-foreground">
        Skipping is fine. The interview stays in settings, and the agent can ask you at any time.
      </footer>
    </main>
  );
}

/** Where you are, without a percentage: five marks, the ones behind you filled. */
function Steps({ count, step }: { count: number; step: number }) {
  return (
    <ol className="flex gap-1.5" aria-label={`Step ${step + 1} of ${count}`}>
      {Array.from({ length: count }, (_, i) => (
        <li key={i} aria-hidden className={`h-1 flex-1 rounded-full transition-colors ${i < step ? "bg-primary/60" : i === step ? "bg-primary" : "bg-white/10"}`} />
      ))}
    </ol>
  );
}
