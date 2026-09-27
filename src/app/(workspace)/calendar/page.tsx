import { CalendarView } from "@/modules/publishing/calendar-view";
import { loadCalendar } from "@/modules/publishing/server/pages";
export const dynamic = "force-dynamic";
export default async function Page() { return <CalendarView initial={await loadCalendar()} />; }
