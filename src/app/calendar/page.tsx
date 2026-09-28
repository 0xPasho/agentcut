import { notFound } from "next/navigation";
import { CalendarView } from "@/modules/publishing/calendar-view";
import { loadCalendar } from "@/modules/publishing/server/pages";
export const dynamic = "force-dynamic";
export default async function Page({ searchParams }: { searchParams: Promise<{ projectId?: string | string[] }> }) {
  const data = await loadCalendar(await searchParams);
  if (!data) notFound();
  return <CalendarView key={data.project?.id ?? "workspace"} {...data} />;
}
