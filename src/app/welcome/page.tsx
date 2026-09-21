import { Welcome } from "@/components/welcome";
import { onboardingState, ONBOARDING_QUESTIONS } from "@/lib/onboarding";

export const dynamic = "force-dynamic";

/**
 * The interview on its own route: reachable from the Library and from the agent,
 * not only on first run. Opening it is reopening it — the previous answers come
 * back to edit, and finishing replaces the section it wrote before. Rendering the
 * page changes nothing on disk; only answering, skipping or finishing does.
 */
export default async function WelcomePage() {
  const state = await onboardingState();
  return <Welcome questions={ONBOARDING_QUESTIONS} initial={state} />;
}
