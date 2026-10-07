import { PackView } from "@/modules/settings/pack-view";

export const dynamic = "force-dynamic";

/** One installed pack (decision 133). The view reads it from the shell's workspace. */
export default async function PackPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PackView id={id} />;
}
