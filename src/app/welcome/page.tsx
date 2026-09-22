import { Welcome } from "@/modules/onboarding/welcome-view";
import { onboardingState, ONBOARDING_QUESTIONS } from "@/modules/onboarding/server/onboarding";

export const dynamic = "force-dynamic";

/**
 * The interview on its own route: reachable from settings and from the agent,
 * not only on first run. Opening it is reopening it — the previous answers come
 * back to edit, and finishing replaces the section it wrote before. Rendering the
 * page changes nothing on disk; only answering, skipping or finishing does.
 */
export default async function WelcomePage() {
  const state = await onboardingState();
  return <Welcome questions={ONBOARDING_QUESTIONS} initial={state} />;
}
