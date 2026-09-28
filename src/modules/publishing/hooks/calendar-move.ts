"use client";
import { useState } from "react";
import type {
  CalendarDrag,
  CalendarMove,
  CalendarUndo,
  PublicationDetail,
  PublishingRun,
} from "../types";
import { calendarPlacements, calendarTime } from "../lib/calendar";
import { dayInZone, intendedTime } from "../lib/resolve";

export function useCalendarMove(
  run: PublishingRun,
  timezone: string,
  onMoved: (day: string) => void,
) {
  const [move, setMove] = useState<CalendarMove | null>(null);
  const [drag, setDrag] = useState<CalendarDrag | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [undo, setUndo] = useState<CalendarUndo | null>(null);
  const [moveError, setMoveError] = useState("");

  function startMove(
    p: PublicationDetail,
    destinationIds: string[],
    day: string,
  ) {
    const times = p.destinations
      .filter((d) => destinationIds.includes(d.id))
      .map((d) => d.confirmedAt ?? intendedTime(p, d));
    const localTimes = times.map((at) =>
      at ? calendarTime(at, timezone) : "12:00",
    );
    setMoveError("");
    setMove({
      publication: p,
      destinationIds,
      day,
      time: new Set(localTimes).size === 1 ? localTimes[0] : "",
    });
  }

  async function applyMove(
    p: PublicationDetail,
    destinationIds: string[],
    day: string,
    time?: string,
  ) {
    setMoveError("");
    try {
      const destinations = p.destinations.filter((d) =>
        destinationIds.includes(d.id),
      );
      const placements = calendarPlacements(
        p,
        destinationIds,
        day,
        timezone,
        time,
      );
      if (
        destinations.every((d) => {
          const before = d.confirmedAt ?? intendedTime(p, d);
          const after = placements.find((item) => item.destinationId === d.id)?.at;
          return !!before && !!after && Date.parse(before) === Date.parse(after);
        })
      ) {
        setMove(null);
        return;
      }
      const remote = destinations.some((d) => d.state === "scheduled");
      if (remote && destinations.length !== 1)
        throw new Error("Move confirmed schedules one account at a time.");
      const result = await run<PublicationDetail>(
        remote
          ? {
              tool: "publication.move",
              id: p.id,
              revision: p.revision,
              destinationId: destinations[0].id,
              at: placements[0].at,
            }
          : {
              tool: "publication.reschedule",
              id: p.id,
              revision: p.revision,
              placements,
            },
      );
      if (!result) return;
      const before = intendedTime(p, destinations[0]);
      setUndo(
        remote
          ? null
          : {
              id: p.id,
              revision: result.revision,
              label: p.label,
              day: before ? dayInZone(before, timezone) : null,
              placements: destinations.map((d) => ({
                destinationId: d.id,
                at: d.scheduledAt,
              })),
            },
      );
      setMove(null);
      onMoved(day);
    } catch (error) {
      setMoveError((error as Error).message);
    }
  }

  async function drop(
    p: PublicationDetail,
    destinationIds: string[],
    day: string,
  ) {
    setDrag(null);
    setOver(null);
    const destinations = p.destinations.filter((d) =>
      destinationIds.includes(d.id),
    );
    if (
      destinations.some((d) => d.state === "scheduled" || !intendedTime(p, d))
    ) {
      startMove(p, destinationIds, day);
      return;
    }
    await applyMove(p, destinationIds, day);
  }

  async function undoMove() {
    if (!undo) return;
    const result = await run<PublicationDetail>({
      tool: "publication.reschedule",
      id: undo.id,
      revision: undo.revision,
      placements: undo.placements,
    });
    if (!result) return;
    if (undo.day) onMoved(undo.day);
    setUndo(null);
  }
  return {
    move,
    setMove,
    drag,
    setDrag,
    over,
    setOver,
    undo,
    setUndo,
    moveError,
    startMove,
    applyMove,
    drop,
    undoMove,
  };
}
