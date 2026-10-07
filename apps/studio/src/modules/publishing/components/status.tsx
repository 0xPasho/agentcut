import {
  AlertCircle,
  BadgeCheck,
  CalendarClock,
  CircleDashed,
  Clock3,
  Loader2,
  Send,
  CircleSlash,
} from "lucide-react";
import { cn } from "cn";
import type { DeliveryState, PublicationStatus } from "@agentcut/core/modules/publishing/types";
import { DELIVERY_PRESENTATION, STATUS_LABELS } from "@agentcut/core/modules/publishing/data";

export function PublicationStatusBadge({
  status,
  label,
}: {
  status: PublicationStatus;
  label?: string;
}) {
  let Icon = CircleDashed;
  if (status === "approved") Icon = BadgeCheck;
  if (status === "pending") Icon = Clock3;
  if (status === "publishing") Icon = Loader2;
  if (status === "scheduled") Icon = CalendarClock;
  if (status === "published") Icon = Send;
  if (status === "attention" || status === "partial") Icon = AlertCircle;
  if (status === "cancelled") Icon = CircleSlash;
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-full bg-foreground/5 px-2 py-1 text-[11px] font-medium leading-tight text-muted-foreground",
        (status === "scheduled" || status === "approved") && "text-foreground",
        (status === "attention" || status === "partial") && "text-primary",
      )}
    >
      <Icon aria-hidden className="size-3.5 shrink-0" />
      {label ?? STATUS_LABELS[status]}
    </span>
  );
}

export function DeliveryStatusBadge({ state }: { state: DeliveryState }) {
  return <PublicationStatusBadge {...DELIVERY_PRESENTATION[state]} />;
}
