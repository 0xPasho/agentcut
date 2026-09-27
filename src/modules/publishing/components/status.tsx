import { AlertCircle, BadgeCheck, CalendarClock, CircleDashed, Clock3, Loader2, Send, CircleSlash } from "lucide-react";
import type { PublicationStatus } from "../types";
import { STATUS_LABELS } from "../data";

export function PublicationStatusBadge({ status }: { status: PublicationStatus }) {
  let Icon = CircleDashed;
  if (status === "approved") Icon = BadgeCheck;
  if (status === "pending") Icon = Clock3;
  if (status === "publishing") Icon = Loader2;
  if (status === "scheduled") Icon = CalendarClock;
  if (status === "published") Icon = Send;
  if (status === "attention" || status === "partial") Icon = AlertCircle;
  if (status === "cancelled") Icon = CircleSlash;
  return <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><Icon aria-hidden className="size-3.5 shrink-0" />{STATUS_LABELS[status]}</span>;
}
