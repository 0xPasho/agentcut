"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { api } from "@/lib/client";
import { Button } from "./ui/button";

/**
 * What is left of the interview on the home page after it was skipped: one line,
 * not a form. The page is for making a video; the interview has its own screen.
 * "Not now" only silences this line — the settings entry and the agent still offer
 * it, which is the point of a skip that is reversible.
 */
export function OnboardingReminder() {
  const router = useRouter();
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;
  return (
    <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
      <Sparkles className="size-3.5 text-primary" aria-hidden />
      The agent does not know who you are yet.
      <Button variant="link" size="sm" className="px-0" render={<Link href="/welcome" />}>Tell it, in two minutes</Button>
      <Button variant="ghost" size="xs" onClick={() => { setHidden(true); void api.workspace({ action: "onboarding.dismiss" }).then(() => router.refresh()).catch(() => { /* shown again next load */ }); }}>
        Not now
      </Button>
    </p>
  );
}
