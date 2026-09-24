import { ProfileSettings } from "@/modules/settings/profile-view";

export const dynamic = "force-dynamic";

/** The root of settings is the person (decision 131). */
export default function SettingsPage() {
  return <ProfileSettings />;
}
