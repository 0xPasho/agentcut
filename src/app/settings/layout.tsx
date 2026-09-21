import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Glass } from "@/components/ui/glass";
import { SettingsNav } from "@/components/settings/nav";

/**
 * Settings is a place, not a drawer at the bottom of another page. Everything that
 * belongs to the person rather than to one project lives under here; /library keeps
 * the media it was always about.
 */
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-6 px-4 pt-4 pb-14 sm:px-6">
      {/* A landmark, not a bare div. The page title lives up here beside the rail and
          the content, and anything outside every landmark is content a screen reader
          cannot jump to. */}
      <header className="sticky top-4 z-20">
        <Glass shape="capsule" thickness="thick" className="flex items-center gap-2 px-3 py-2.5 sm:gap-3 sm:px-4">
          <Button aria-label="Back to projects" variant="ghost" size="icon" nativeButton={false} render={<Link href="/" />}>
            <ArrowLeft className="size-4" />
          </Button>
          <h1 className="flex-1 text-sm font-medium">Settings</h1>
        </Glass>
      </header>

      <div className="flex flex-col gap-6 md:flex-row md:items-start md:gap-10">
        <SettingsNav />
        <main className="flex min-w-0 flex-1 flex-col gap-6">{children}</main>
      </div>
    </div>
  );
}
