"use client";
import { useEffect, useId, useMemo, useState } from "react";
import Link from "next/link";
import { Loader2, MessageSquareText, NotebookPen, Sparkles, WandSparkles } from "lucide-react";
import { api } from "@/common/api/client";
import { mergeOnboardingPreferences, splitOnboardingPreferences } from "@/modules/rules/lib/preferences-section";
import type { Rule } from "@/modules/rules/types";
import type { Glossary } from "@/modules/rules/server/glossary";
import type { Observation, Proposals } from "@/modules/rules/server/observations";
import { Button } from "@/common/ui/button";
import { Disclosure } from "@/common/ui/disclosure";
import { Label } from "@/common/ui/label";
import { Textarea } from "@/common/ui/textarea";
import { Empty, ErrorLine, Loading, Panel, PanelHeading, SectionHeader } from "./components/section-header";
import { useWorkspaceSettings } from "./hooks";
import { count, interviewLine } from "./lib";

/**
 * You: the profile (decision 131). Three things about one person, in the order
 * they were learned — what you said about yourself, what you wrote about your
 * taste, and what you corrected without saying anything.
 *
 * The interview's answers are edited here in place; **Rewrite my preferences** runs
 * the same `onboarding.run` the full-screen interview runs, and writes the same
 * marked section of `preferences.md`. Editing your own half and putting the file
 * back together goes through `mergeOnboardingPreferences`, so a hand edit can never
 * delete a marker and turn the next rerun into a second copy (decision 62). Saving
 * is `preferences.set`, the agent's tool, the only writer of this file.
 */
export function ProfileSettings() {
  const { data, error, pending, run, setError } = useWorkspaceSettings();
  const parts = useMemo(() => splitOnboardingPreferences(data?.preferences ?? ""), [data?.preferences]);

  const write = (own: string, generated: string) =>
    run("preferences", () => api.workspace({ action: "preferences.set", text: generated ? mergeOnboardingPreferences(own, generated) : own }));

  if (!data) return (
    <section className="flex flex-col gap-5">
      <SectionHeader title="You">What you make, who it is for, and how you like it done. Every agent reads this before it decides anything.</SectionHeader>
      <Loading label="Loading your profile" />
    </section>
  );

  return (
    <section className="flex flex-col gap-5">
      <SectionHeader title="You">
        What you make, who it is for, and how you like it done. Every agent reads this before it
        decides anything — it is your text, never treated as untrusted material.
      </SectionHeader>

      <Answers
        questions={data.onboarding.questions}
        initial={data.onboarding.answers}
        status={data.onboarding.status}
        hasSection={!!parts.generated}
        pending={pending}
        onSave={(answers) => run("answers", () => api.workspace({ action: "onboarding.answer", answers }))}
        onRewrite={(answers) => run("rewrite", async () => {
          await api.workspace({ action: "onboarding.answer", answers });
          // The streaming route, so a slow agent cannot time the request out; the
          // progress lines are not shown here, the rail's count is enough.
          await api.runOnboarding(answers);
        })}
      />

      <OwnPreferences own={parts.own} generated={parts.generated} pending={pending === "preferences"} onSave={write} />

      {parts.generated && (
        <Panel className="flex flex-col gap-3">
          <PanelHeading
            title="What the interview wrote"
            icon={<Sparkles className="size-4" />}
            action={<Button size="sm" variant="ghost" disabled={pending === "preferences"} onClick={() => write(parts.own, "")}>Remove this section</Button>}
          >
            Lines the agent drew from your answers. They sit apart from your own so rewriting them never touches what you typed.
          </PanelHeading>
          {/* It scrolls, so it is focusable: a region a mouse can scroll and a keyboard
              cannot is a region a keyboard user cannot read to the end. */}
          <pre tabIndex={0} role="region" aria-label="Preferences written by the setup interview"
            className="max-h-64 overflow-auto rounded-xl bg-foreground/[0.04] p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap">{parts.generated}</pre>
        </Panel>
      )}

      <Corrections
        observations={data.observations}
        glossary={data.glossary}
        preferences={data.preferences}
        pending={pending}
        onError={setError}
        onAcceptRule={(rule) => run(`save:${rule.id}`, () => api.workspace({ action: "rules.save", rule }))}
        onAcceptGlossary={(glossary) => run("glossary", () => api.workspace({ action: "glossary.save", glossary }))}
        onAcceptPreferences={(text) => run("preferences", () => api.workspace({ action: "preferences.set", text }))}
      />
      <ErrorLine>{error}</ErrorLine>
    </section>
  );
}

/**
 * The interview's answers, editable where they can be read. The full-screen
 * interview at /welcome asks the same questions one at a time for a first run; here
 * they are five fields on one panel, because the second time you know the questions.
 */
function Answers({ questions, initial, status, hasSection, pending, onSave, onRewrite }: {
  questions: readonly { id: string; label: string; placeholder: string; required: boolean }[];
  initial: Record<string, string>; status: string; hasSection: boolean; pending: string;
  onSave: (answers: Record<string, string>) => void; onRewrite: (answers: Record<string, string>) => void;
}) {
  const id = useId();
  const [answers, setAnswers] = useState<Record<string, string>>(initial);
  // The shell reloads after every save on this page, and each reload is a new object
  // with the same answers in it; only different answers replace what is being typed.
  const saved = JSON.stringify(initial);
  useEffect(() => { setAnswers(JSON.parse(saved)); }, [saved]);
  const dirty = questions.some((question) => (answers[question.id] ?? "") !== (initial[question.id] ?? ""));
  const answered = questions.filter((question) => (answers[question.id] ?? "").trim()).length;
  const canRewrite = !!(answers[questions[0]?.id ?? ""] ?? "").trim();
  const busy = pending === "answers" || pending === "rewrite";

  return (
    <Panel as="form" className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); onSave(answers); }}>
      <PanelHeading
        title="About you"
        icon={<MessageSquareText className="size-4" />}
        action={<Button size="sm" variant="outline" nativeButton={false} render={<Link href="/welcome" />}>{status === "done" ? "Redo the interview" : "Take the interview"}</Button>}
      >
        {interviewLine(status, hasSection)}
      </PanelHeading>
      <div className="grid gap-4 sm:grid-cols-2">
        {questions.map((question, index) => (
          <div key={question.id} className={index === 0 ? "space-y-1.5 sm:col-span-2" : "space-y-1.5"}>
            <Label htmlFor={`${id}-${question.id}`}>{question.label}{question.required ? "" : <span className="font-normal text-muted-foreground"> (optional)</span>}</Label>
            <Textarea id={`${id}-${question.id}`} rows={index === 0 ? 3 : 2} value={answers[question.id] ?? ""} placeholder={question.placeholder}
              onChange={(e) => setAnswers({ ...answers, [question.id]: e.target.value })} />
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" variant={dirty ? "default" : "outline"} disabled={!dirty || busy}>
          {pending === "answers" && <Loader2 aria-hidden className="motion-safe:animate-spin" />}Save answers
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={!canRewrite || busy} onClick={() => onRewrite(answers)}>
          {pending === "rewrite" ? <Loader2 aria-hidden className="motion-safe:animate-spin" /> : <WandSparkles aria-hidden />}Rewrite my preferences
        </Button>
        <span className="text-xs text-muted-foreground">
          {pending === "rewrite" ? "The agent is reading your answers. This takes a moment." : `${count(answered, "answer")} of ${questions.length}. Rewriting turns them into the section below.`}
        </span>
      </div>
    </Panel>
  );
}

function OwnPreferences({ own, generated, pending, onSave }: { own: string; generated: string; pending: boolean; onSave: (own: string, generated: string) => void }) {
  const id = useId();
  const [draft, setDraft] = useState(own);
  useEffect(() => { setDraft(own); }, [own]);
  const dirty = draft !== own;
  return (
    <Panel as="form" className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); onSave(draft, generated); }}>
      <PanelHeading title="In your words" icon={<NotebookPen className="size-4" />}>
        Markdown, one preference a line reads best. The agent follows them unless what you ask for in the moment says otherwise.
      </PanelHeading>
      <Textarea
        id={`${id}-own`} rows={8} className="font-mono text-xs leading-relaxed" value={draft}
        aria-label="Preferences in your words"
        placeholder={"Short hooks, under three seconds.\nNever emojis in captions.\nTwo words a line.\nMusic always under the voice."}
        onChange={(e) => setDraft(e.target.value)}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" variant={dirty ? "default" : "outline"} disabled={!dirty || pending}>
          {pending && <Loader2 aria-hidden className="motion-safe:animate-spin" />}Save preferences
        </Button>
        {dirty && <Button type="button" size="sm" variant="ghost" onClick={() => setDraft(own)}>Discard</Button>}
      </div>
    </Panel>
  );
}

/**
 * The observation bank (decision 39): every correction you made to something an
 * agent placed, noted without asking. Nothing here becomes a rule on its own —
 * **Review my preferences** has an agent propose, and each proposal is accepted with
 * the tool that writes it: `rules.save`, `glossary.save`, `preferences.set`.
 */
function Corrections({ observations, glossary, preferences, pending, onError, onAcceptRule, onAcceptGlossary, onAcceptPreferences }: {
  observations: Observation[]; glossary: Glossary; preferences: string; pending: string;
  onError: (message: string) => void;
  onAcceptRule: (rule: Rule) => void;
  onAcceptGlossary: (glossary: Glossary) => void;
  onAcceptPreferences: (text: string) => void;
}) {
  const [proposals, setProposals] = useState<Proposals | null>(null);
  const [busy, setBusy] = useState(false);
  const [accepted, setAccepted] = useState<Set<string>>(new Set());
  const accept = (key: string, action: () => void) => { action(); setAccepted(new Set([...accepted, key])); };

  if (!observations.length) return (
    <Empty title="Nothing corrected yet">
      When you change something an agent, a rule or a template placed, one line lands here. Ask
      for a review once there are a few, and an agent proposes rules, names and preferences from them.
    </Empty>
  );

  return (
    <Panel className="flex flex-col gap-3">
      <PanelHeading
        title="What you have corrected"
        icon={<WandSparkles className="size-4" />}
        action={
          <Button size="sm" variant="outline" disabled={busy} onClick={async () => {
            setBusy(true); onError(""); setAccepted(new Set());
            try { setProposals(await api.workspace<Proposals>({ action: "observations.review" })); }
            catch (e) { onError((e as Error).message); }
            finally { setBusy(false); }
          }}>{busy ? <Loader2 aria-hidden className="motion-safe:animate-spin" /> : <WandSparkles aria-hidden />}Review my preferences</Button>
        }
      >
        {count(observations.length, "recent correction")}, noted without asking. A review has an agent propose rules, names and preferences from them; you accept each one.
      </PanelHeading>

      <Disclosure variant="plain" summary="Recent corrections" summaryClassName="-ms-2">
        <ul className="space-y-1 text-xs text-muted-foreground">{observations.slice(-15).reverse().map((o) => <li key={o.id}>{o.text}</li>)}</ul>
      </Disclosure>

      {proposals && (
        <div className="flex flex-col gap-3 rounded-xl bg-foreground/[0.04] p-3 text-sm">
          {proposals.notes && <p className="text-xs text-muted-foreground">{proposals.notes}</p>}
          {!proposals.rules.length && !proposals.glossary.length && !proposals.preferences && (
            <p className="text-xs text-muted-foreground">Nothing repeats often enough to be worth a rule yet.</p>
          )}
          {proposals.rules.map((rule) => (
            <div key={rule.id} className="flex flex-wrap items-start gap-2">
              <div className="min-w-0 flex-1">
                <span className="font-medium">{rule.name}</span>
                <span className="block text-xs text-muted-foreground">When {rule.when} → {[rule.then.template && `template ${rule.then.template}`, rule.then.overrides && `settings ${JSON.stringify(rule.then.overrides)}`, rule.then.prompt].filter(Boolean).join(" · ")}</span>
              </div>
              <Button size="xs" variant="outline" disabled={accepted.has(`rule:${rule.id}`) || pending === `save:${rule.id}`} onClick={() => accept(`rule:${rule.id}`, () => onAcceptRule(rule))}>
                {accepted.has(`rule:${rule.id}`) ? "Saved" : "Save rule"}
              </Button>
            </div>
          ))}
          {proposals.glossary.map((term) => (
            <div key={term.term} className="flex flex-wrap items-start gap-2">
              <div className="min-w-0 flex-1">
                <span className="font-medium">{term.term}</span>
                <span className="block text-xs text-muted-foreground">{term.aliases.length ? `heard as ${term.aliases.join(", ")}` : ""}{term.note ? ` · ${term.note}` : ""}</span>
              </div>
              <Button size="xs" variant="outline" disabled={accepted.has(`term:${term.term}`)} onClick={() => accept(`term:${term.term}`, () => onAcceptGlossary({ terms: [...glossary.terms.filter((t) => t.term.toLowerCase() !== term.term.toLowerCase()), term] }))}>
                {accepted.has(`term:${term.term}`) ? "Added" : "Add to glossary"}
              </Button>
            </div>
          ))}
          {proposals.preferences && (
            <div className="flex flex-wrap items-start gap-2">
              <p className="min-w-0 flex-1 text-xs whitespace-pre-wrap">{proposals.preferences}</p>
              <Button size="xs" variant="outline" disabled={accepted.has("prefs")} onClick={() => accept("prefs", () => onAcceptPreferences([preferences, proposals.preferences].filter(Boolean).join("\n")))}>
                {accepted.has("prefs") ? "Added" : "Add to preferences"}
              </Button>
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}
