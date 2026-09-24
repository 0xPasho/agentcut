import { permanentRedirect } from "next/navigation";

/** Preferences are part of the profile now (decision 131); the old address still lands there. */
export default function PreferencesPage() {
  permanentRedirect("/settings");
}
