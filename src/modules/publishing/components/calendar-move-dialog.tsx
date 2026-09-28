"use client";
import { Button } from "../../../common/ui/button";
import { Input } from "../../../common/ui/input";
import { DatePicker } from "../../../common/ui/date-picker";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../../common/ui/dialog";
import type {
  CalendarMove,
  PublicationDetail,
  PublishingOverview,
} from "../types";
import { NETWORK_LABELS } from "../data";
import { dayInZone } from "../lib/resolve";

export function CalendarMoveDialog({
  move,
  setMove,
  data,
  busy,
  error,
  onMove,
  onOpenPublication,
}: {
  move: CalendarMove | null;
  setMove: (move: CalendarMove | null) => void;
  data: PublishingOverview;
  busy: boolean;
  error: string;
  onMove: (
    p: PublicationDetail,
    ids: string[],
    day: string,
    time?: string,
  ) => Promise<void>;
  onOpenPublication: (id: string) => void;
}) {
  const destinations =
    move?.publication.destinations.filter((d) =>
      move.destinationIds.includes(d.id),
    ) ?? [];
  const remote = destinations.some((d) => d.state === "scheduled");
  const phone =
    remote &&
    destinations.some(
      (d) =>
        data.connections.find(
          (c) =>
            c.id ===
            data.accounts.find((a) => a.id === d.accountId)?.connectionId,
        )?.provider === "iphone",
    );
  return (
    <Dialog
      open={!!move}
      onOpenChange={(open) => {
        if (!open && !busy) setMove(null);
      }}
    >
      <DialogContent showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle>Move publication</DialogTitle>
          <DialogDescription>{move?.publication.label}</DialogDescription>
        </DialogHeader>
        {move && (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void onMove(
                move.publication,
                move.destinationIds,
                move.day,
                move.time || undefined,
              );
            }}
          >
            <p className="text-xs text-muted-foreground">
              {destinations
                .map((d) => {
                  const account = data.accounts.find(
                    (a) => a.id === d.accountId,
                  );
                  return account
                    ? `${account.name} · ${NETWORK_LABELS[account.network]}`
                    : "Account";
                })
                .join(", ")}
            </p>
            <div className="space-y-1.5 text-sm">
              <label htmlFor="calendar-move-day">Day</label>
              <DatePicker
                id="calendar-move-day"
                label="Day"
                value={move.day}
                today={dayInZone(new Date().toISOString(), data.settings.timezone)}
                disabled={busy || phone}
                onChange={(day) => setMove({ ...move, day })}
              />
            </div>
            <label className="block space-y-1.5 text-sm">
              Time
              <Input
                type="time"
                value={move.time}
                disabled={busy || phone}
                onChange={(e) => setMove({ ...move, time: e.target.value })}
              />
            </label>
            <p className="text-xs text-muted-foreground">
              All times in {data.settings.timezone.replaceAll("_", " ")}.
              {!move.time &&
                " Leave time empty to keep each account’s current time."}
            </p>
            {remote && (
              <p className="text-sm">
                {phone
                  ? "This time is confirmed in the iPhone app. Open the publication to cancel and verify that schedule before preparing a new release."
                  : "This changes the schedule already confirmed by the publishing service."}
              </p>
            )}
            {error && (
              <p
                role="alert"
                className="text-sm text-destructive whitespace-pre-wrap"
              >
                {error}
              </p>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => setMove(null)}
              >
                Cancel
              </Button>
              {phone && (
                <Button
                  type="button"
                  onClick={() => {
                    setMove(null);
                    onOpenPublication(move.publication.id);
                  }}
                >
                  Open publication
                </Button>
              )}
              {!phone && (
                <Button type="submit" disabled={busy}>
                  {busy ? "Moving…" : "Move publication"}
                </Button>
              )}
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
