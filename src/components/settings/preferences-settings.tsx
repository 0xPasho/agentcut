"use client";
import { useEffect, useId, useMemo, useState } from "react";
import Link from "next/link";
import { Loader2, Sparkles, Wand2 } from "lucide-react";
import { api } from "@/lib/client";
import { mergeOnboardingPreferences, splitOnboardingPreferences } from "@/lib/preferences-section";
import type { Rule } from "@/lib/rules/schema";
import type { Glossary } from "@/lib/glossary";
import type { Observation, Proposals } from "@/lib/observations";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SectionHeader } from "./section-header";
import { useWorkspaceSettings } from "./use-workspace";

/**
 * preferences.md, by hand.
 *
 * The file has two halves and they are shown apart: the lines the owner wrote, and
 * the marked section the setup interview wrote. Editing the owner's half and putting
 * the file back together goes through `mergeOnboardingPreferences`, the same function
 * the interview uses, so a hand edit can never delete a marker and turn the next
 * rerun into a second copy of everything (decision 62). Saving is `preferences.set`,
 * the agent's tool, which is the only writer of this file.
 */
export function PreferencesSettings() {
  const { data, error, pending, run, setError } = useWorkspaceSettings();
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);

  const parts = useMemo(() => splitOnboardingPreferences(data?.preferences ?? ""), [data?.preferences]);
  useEffect(() => { if (data) setDraft(splitOnboardingPreferences(data.preferences).own); }, [data]);

  const write = (own: string, generated: string) =>
    run("preferences", () => api.workspace({
      action: "preferences.set",
      text: generated ? mergeOnboardingPreferences(own, generated) : own,
    }));

  const onboarding = data?.onboarding;
  const dirty = draft !== null && draft !== parts.own;

  return (
    <section className="flex flex-col gap-5">
      <SectionHeader title="Preferences">
        How you like your videos, in your own words. Every agent reads this before it decides anything —
        it is your text, not something to be interpreted as untrusted material.
      </SectionHeader>

      <form
        className="flex flex-col gap-3 rounded-2xl bg-card px-4 py-4 ring-1 ring-foreground/10"
        onSubmit={(e) => { e.preventDefault(); write(draft ?? "", parts.generated); }}
      >
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-own`}>In your words</Label>
          <Textarea
            id={`${id}-own`} rows={10} className="font-mono text-xs leading-relaxed"
            value={draft ?? ""} disabled={draft === null}
            aria-describedby={`${id}-own-help`}
            placeholder={"Short hooks, under three seconds.\nNever emojis in captions.\nTwo words a line.\nMusic always under the voice."}
            onChange={(e) => setDraft(e.target.value)}
          />
          <p id={`${id}-own-help`} className="text-xs text-muted-foreground">
            Markdown. One preference a line reads best, and the agent follows them unless what you ask
            for in the moment says otherwise.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" size="sm" disabled={!dirty || pending === "preferences"}>
            {pending === "preferences" && <Loader2 aria-hidden className="motion-safe:animate-spin" />}Save preferences
          </Button>
          {dirty && <Button type="button" size="sm" variant="ghost" onClick={() => setDraft(parts.own)}>Discard</Button>}
        </div>
      </form>

      {onboarding && (
        <div className="flex flex-col gap-3 rounded-2xl bg-card px-4 py-4 ring-1 ring-foreground/10">
          <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
            <Sparkles aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">The setup interview</p>
              <p className="mt-0.5 text-sm text-muted-foreground">{interviewLine(onboarding.status, !!parts.generated)}</p>
            </div>
            <Button size="sm" variant="outline" render={<Link href="/welcome" />}>
              {onboarding.status === "done" ? "Redo the interview" : "Answer the questions"}
            </Button>
          </div>

          {parts.generated && (
            <>
              <pre className="max-h-64 overflow-auto rounded-xl bg-foreground/[0.04] p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap">{parts.generated}</pre>
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  size="sm" variant="ghost" disabled={pending === "preferences"}
                  onClick={() => write(draft ?? parts.own, "")}
                >Remove this section</Button>
                <p className="text-xs text-muted-foreground">Your own lines above stay exactly as they are.</p>
              </div>
            </>
          )}

          {onboarding.status === "skipped" && (
            <p className="text-xs text-muted-foreground">
              <button
                type="button" className="underline underline-offset-2"
                onClick={() => run("reopen", () => api.workspace({ action: "onboarding.reopen" }))}
              >Put the reminder back on the home page</button>
            </p>
          )}
        </div>
      )}

      {data && (
        <Review
          observations={data.observations}
          glossary={data.glossary}
          preferences={data.preferences}
          pending={pending}
          onError={setError}
          onAcceptRule={(rule) => run(`save:${rule.id}`, () => api.workspace({ action: "rules.save", rule }))}
          onAcceptGlossary={(glossary) => run("glossary", () => api.workspace({ action: "glossary.save", glossary }))}
          onAcceptPreferences={(text) => run("preferences", () => api.workspace({ action: "preferences.set", text }))}
        />
      )}

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </section>
  );
}

function interviewLine(status: string, hasSection: boolean): string {
  if (status === "done") return hasSection
    ? "You answered it. The lines it wrote are below, and answering again replaces them."
    : "You answered it, and the section it wrote has since been removed.";
  if (status === "skipped") return "You skipped it. Whatever you had typed is kept, and you can finish it whenever.";
  return "Five questions about what you make and who it is for. The answers become preferences the agent follows.";
}

/**
 * The observation bank, and the one place it turns into standing preferences: on
 * request, an agent proposes, and each proposal is accepted by hand or ignored.
 * Nothing here saves anything until a button is pressed.
 */
function Review({ observations, glossary, preferences, pending, onError, onAcceptRule, onAcceptGlossary, onAcceptPreferences }: {
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

  return (
    <section className="flex flex-col gap-3 rounded-2xl bg-card px-4 py-4 ring-1 ring-foreground/10">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">What you have corrected</p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {observations.length
              ? `${observations.length} recent correction${observations.length === 1 ? "" : "s"}, noted without asking. Ask for a review and an agent proposes rules, names and preferences from them.`
              : "When you change something an agent, a rule or a template placed, one line lands here. Nothing has yet."}
          </p>
        </div>
        <Button
          size="sm" variant="outline" disabled={busy || !observations.length}
          onClick={async () => {
            setBusy(true); onError(""); setAccepted(new Set());
            try { setProposals(await api.workspace<Proposals>({ action: "observations.review" })); }
            catch (e) { onError((e as Error).message); }
            finally { setBusy(false); }
          }}
        >{busy ? <Loader2 aria-hidden className="motion-safe:animate-spin" /> : <Wand2 aria-hidden />}Review my preferences</Button>
      </div>

      {!!observations.length && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">Recent corrections</summary>
          <ul className="mt-2 space-y-1 text-muted-foreground">{observations.slice(-15).reverse().map((o) => <li key={o.id}>{o.text}</li>)}</ul>
        </details>
      )}

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
    </section>
  );
}
