import { Suspense } from "react";
import { GlossarySettings } from "@/modules/settings/glossary-settings-view";

export const dynamic = "force-dynamic";

/** The subjects filter lives in the URL, which is why the view reads the search params. */
export default function GlossarySettingsPage() {
  return <Suspense><GlossarySettings /></Suspense>;
}
