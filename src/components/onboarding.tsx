"use client";
import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles } from "lucide-react";
import { api } from "@/lib/client";
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";

/**
 * First run. Five questions about who is editing; the answers become preferences the
 * agent follows everywhere, and glossary entries for the names. Skippable, once.
 */
export function Onboarding({ questions }: { questions: ReadonlyArray<{ id: string; label: string; placeholder: string }> }) {
  const id = useId();
  const router = useRouter();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<"run" | "skip" | "">("");
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ preferences: string; glossary: Array<{ term: string }> } | null>(null);
  const finish = async (action: "onboarding.run" | "onboarding.skip") => {
    setPending(action === "onboarding.run" ? "run" : "skip"); setError("");
    try {
      const result = await api.workspace<{ preferences?: string; glossary?: Array<{ term: string }> }>({ action, answers });
      if (action === "onboarding.run") setDone({ preferences: result.preferences ?? "", glossary: result.glossary ?? [] });
      else router.refresh();
    } catch (e) { setError((e as Error).message); }
    finally { setPending(""); }
  };
  if (done) return (
    <Card><CardContent className="space-y-3 py-6">
      <p className="text-sm font-medium">Preferences written.</p>
      <pre className="whitespace-pre-wrap rounded-xl border border-border p-3 text-xs text-muted-foreground">{done.preferences}</pre>
      {!!done.glossary.length && <p className="text-xs text-muted-foreground">Glossary: {done.glossary.map((g) => g.term).join(", ")}. Edit both any time in the Library.</p>}
      <Button size="sm" onClick={() => router.refresh()}>Continue</Button>
    </CardContent></Card>
  );
  return (
    <Card aria-busy={!!pending}><CardContent className="space-y-4 py-6">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold tracking-tight">Tell the agent who you are</h2>
        <p className="text-sm text-muted-foreground">Five questions, two minutes. The answers become preferences the agent follows in every video, and you can edit them any time. Or skip and let it learn from your corrections.</p>
      </div>
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); void finish("onboarding.run"); }}>
        {questions.map((q) => <div key={q.id} className={`space-y-1 ${q.id === "annoys" || q.id === "who" ? "sm:col-span-2" : ""}`}>
          <Label htmlFor={`${id}-${q.id}`}>{q.label}</Label>
          <Textarea id={`${id}-${q.id}`} rows={2} placeholder={q.placeholder} value={answers[q.id] ?? ""} onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })} />
        </div>)}
        <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
          <Button type="submit" disabled={!!pending || !Object.values(answers).some((a) => a.trim())}>{pending === "run" ? <Loader2 className="motion-safe:animate-spin" /> : <Sparkles />}Write my preferences</Button>
          <Button type="button" variant="ghost" disabled={!!pending} onClick={() => void finish("onboarding.skip")}>Skip for now</Button>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </div>
      </form>
    </CardContent></Card>
  );
}
