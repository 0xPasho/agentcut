import { WorkspaceShell } from "@/modules/settings/components/shell";

/**
 * Everything that belongs to the person rather than to one project lives under
 * this shell (decision 130): the library and every settings section share one
 * header and one rail, so /library and /settings are two doors into one place.
 */
export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return <WorkspaceShell>{children}</WorkspaceShell>;
}
