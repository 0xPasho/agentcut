"use client";

import Link from "next/link";
import { useState } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Film,
  Inbox,
  Library,
  Settings2,
  Smartphone,
} from "lucide-react";
import { cn } from "cn";
import { AgentcutIcon } from "../../common/components/agentcut-mark";
import { Button } from "../../common/ui/button";
import { Checkbox } from "../../common/ui/checkbox";
import { Disclosure } from "../../common/ui/disclosure";
import { Glass } from "../../common/ui/glass";
import { Input } from "../../common/ui/input";
import { Tabs, TabsList, TabsTrigger } from "../../common/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "../../common/ui/dialog";
import { usePublishing } from "./hooks";
import type {
  CalendarMove,
  PublicationDetail,
  PublishingOverview,
} from "./types";
import { localInstant } from "./lib/schedule";
import { calendarDates, adjacentPeriod, calendarPeriodLabel } from "./lib/calendar";
import { NETWORK_LABELS, STATUS_LABELS } from "./data";
import { dayInZone, intendedTime } from "./lib/resolve";
import { NetworkIcon } from "./components/network-icon";
import { PublicationStatusBadge } from "./components/status";
import { PublicationForm } from "./components/publication-panel";
import { PublishingSelect } from "./components/publishing-select";

export function CalendarView({ initial }: { initial: PublishingOverview }) {
  const today = dayInZone(new Date().toISOString(), initial.settings.timezone);
  const [anchor, setAnchor] = useState(today);
  const [view, setView] = useState("month");
  const [day, setDay] = useState(today);
  const [account, setAccount] = useState("");
  const [status, setStatus] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [offset, setOffset] = useState(0);
  const [move, setMove] = useState<CalendarMove | null>(null);
  const [moveError, setMoveError] = useState("");
  const dates = calendarDates(anchor, view);
  const {
    data = initial,
    error,
    busy,
    run,
  } = usePublishing(undefined, initial, {
    from: dates[0],
    to: dates.at(-1)!,
    offset,
  });
  const publications = data.publications.filter(
    (p) =>
      (!account || p.destinations.some((d) => d.accountId === account)) &&
      (!status || p.status === status),
  );
  const attention = publications.filter(
    (p) => p.status === "attention" || p.status === "partial",
  );
  const phoneDue = publications.filter((p) =>
    p.destinations.some((d) => {
      const connectionId = data.accounts.find(
        (a) => a.id === d.accountId,
      )?.connectionId;
      const phone =
        data.connections.find((c) => c.id === connectionId)?.provider ===
        "iphone";
      const at = intendedTime(p, d);
      return (
        phone &&
        ["not_sent", "queued", "unknown", "sending"].includes(d.state) &&
        (!at ||
          Date.parse(at) - data.settings.leadMinutes * 60_000 <= Date.now())
      );
    }),
  );
  const unscheduled = publications.filter(
    (p) => !p.destinations.some((d) => intendedTime(p, d) || d.confirmedAt),
  );
  const current = data.publications.find((p) => p.id === open);
  const revisions = Object.fromEntries(
    data.publications.map((p) => [p.id, p.revision]),
  );
  const navigate = (step: number) => {
    const next = adjacentPeriod(anchor, view, step);
    setOffset(0);
    setAnchor(next);
    setDay(next);
  };
  const onDay = (date: string) =>
    publications.filter((p) =>
      p.destinations.some((d) => {
        const at = d.confirmedAt ?? intendedTime(p, d);
        return at && dayInZone(at, data.settings.timezone) === date;
      }),
    );
  const showPublication = (id: string) => {
    setDirty(false);
    setOpen(id);
  };
  const days = dates.map((date) => ({ date, entries: onDay(date) }));
  const scheduledCount = new Set(
    days.flatMap(({ entries }) => entries.map((p) => p.id)),
  ).size;
  const selectedDayEntries = onDay(day);
  const hasFilters = !!(account || status);
  const visibleDays = view === "agenda"
    ? days.filter(({ entries }) => entries.length > 0)
    : days;
  const clearFilters = () => {
    setAccount("");
    setStatus("");
    setOffset(0);
  };
  return (
    <main className="mx-auto min-h-screen w-full max-w-[1600px] space-y-6 px-4 pt-4 pb-12 sm:px-8">
      <a
        href="#publication-calendar"
        className="sr-only focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
      >
        Skip to calendar
      </a>
      <Glass
        shape="capsule"
        className="flex flex-wrap items-center gap-2 px-3 py-2"
      >
        <Button
          variant="ghost"
          size="icon"
          aria-label="Back to projects"
          nativeButton={false}
          render={<Link href="/" />}
        >
          <ArrowLeft className="size-4" />
        </Button>
        <AgentcutIcon className="size-6" />
        <span className="text-sm font-medium">Calendar</span>
        <nav aria-label="Workspace" className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            nativeButton={false}
            render={<Link href="/library" />}
          >
            <Library className="size-4" aria-hidden />
            <span className="hidden sm:inline">Library</span>
            <span className="sr-only sm:hidden">Library</span>
          </Button>
          <Button
            variant="ghost"
            nativeButton={false}
            render={<Link href="/settings/publishing" />}
          >
            <Settings2 className="size-4" aria-hidden />
            <span className="hidden sm:inline">Publishing</span>
            <span className="sr-only sm:hidden">Publishing settings</span>
          </Button>
        </nav>
      </Glass>

      <header className="flex flex-wrap items-end justify-between gap-3 py-2">
        <div>
          <h1 className="font-heading text-2xl tracking-tight text-balance sm:text-3xl">
            Publication calendar
          </h1>
          <p className="mt-2 text-sm text-pretty text-muted-foreground">
            Plan your releases. See what’s ready, scheduled and live.
          </p>
        </div>
        <span
          title={data.settings.timezone}
          className="flex items-center gap-1.5 text-xs text-muted-foreground"
        >
          <Clock3 className="size-3.5" aria-hidden />
          All times in {data.settings.timezone.split("/").at(-1)!.replaceAll("_", " ")}
        </span>
      </header>
      {error && (
        <p
          role="alert"
          className="whitespace-pre-wrap text-sm text-destructive"
        >
          {error}
        </p>
      )}
      {!!attention.length && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-3 rounded-2xl bg-card p-3 ring-1 ring-foreground/10"
        >
          <span className="text-sm">
            {attention.length} publications need attention
          </span>
          {attention.map((p) => (
            <Button
              key={p.id}
              size="sm"
              variant="outline"
              onClick={() => showPublication(p.id)}
            >
              {p.label}
            </Button>
          ))}
        </div>
      )}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_288px]">
        <div className="min-w-0 space-y-3 lg:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h2 id="calendar-period" className="me-2 text-lg font-medium tracking-tight tabular-nums sm:text-xl">
                {calendarPeriodLabel(anchor, view)}
              </h2>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Previous period"
                onClick={() => navigate(-1)}
              >
                <ChevronLeft className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Next period"
                onClick={() => navigate(1)}
              >
                <ChevronRight className="size-4" />
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setAnchor(today);
                  setDay(today);
                  setOffset(0);
                }}
              >
                Today
              </Button>
            </div>
            <Tabs
              className="w-full sm:w-auto"
              value={view}
              onValueChange={(value) => {
                setView(String(value));
                setAnchor(day);
                setOffset(0);
              }}
            >
              <TabsList aria-label="Calendar view" className="w-full sm:w-fit">
                <TabsTrigger value="month">Month</TabsTrigger>
                <TabsTrigger value="week">Week</TabsTrigger>
                <TabsTrigger value="agenda">Agenda</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <PublishingSelect
              aria-label="Filter by account"
              className="w-[calc(50%-0.25rem)] sm:w-44"
              value={account}
              onValueChange={(value) => {
                setAccount(value);
                setOffset(0);
              }}
            >
              <option value="">All accounts</option>
              {data.accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} · {NETWORK_LABELS[a.network]}
                </option>
              ))}
            </PublishingSelect>
            <PublishingSelect
              aria-label="Filter by status"
              className="w-[calc(50%-0.25rem)] sm:w-44"
              value={status}
              onValueChange={(value) => {
                setStatus(value);
                setOffset(0);
              }}
            >
              <option value="">All statuses</option>
              {Object.entries(STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </PublishingSelect>
            {hasFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearFilters}
              >
                Clear filters
              </Button>
            )}
            <label className="flex w-full items-center justify-between gap-2 text-xs text-muted-foreground sm:ms-auto sm:w-auto">
              Go to
              <Input
                aria-label="Go to date"
                className="w-auto max-w-40"
                type="date"
                value={anchor}
                onChange={(e) => {
                  if (e.target.value) {
                    setAnchor(e.target.value);
                    setDay(e.target.value);
                    setOffset(0);
                  }
                }}
              />
            </label>
          </div>
        </div>
        <section
          id="publication-calendar"
          aria-labelledby="calendar-period"
          tabIndex={-1}
          className="min-w-0 space-y-3 scroll-mt-4 rounded-3xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
        >
          <div className="overflow-hidden rounded-3xl bg-card ring-1 ring-foreground/10">
            {view !== "agenda" && (
              <div className="grid grid-cols-7 border-b border-foreground/10 bg-foreground/[0.025]">
                {dates.slice(0, 7).map((date) => (
                  <span
                    key={date}
                    className="py-3 text-center text-xs font-medium text-muted-foreground"
                  >
                    {new Date(`${date}T12:00:00`).toLocaleDateString(
                      undefined,
                      { weekday: "short" },
                    )}
                  </span>
                ))}
              </div>
            )}
            <div
              className={cn(
                view === "agenda"
                  ? "divide-y divide-foreground/10"
                  : "grid grid-cols-7",
                view === "month" && "sm:min-h-[clamp(25rem,calc(100dvh-25rem),40rem)]",
              )}
            >
              {visibleDays.map(({ date, entries }) => {
                const isSelected = day === date;
                const dateLabel = new Date(`${date}T12:00:00`).toLocaleDateString(
                  undefined,
                  { weekday: "long", month: "long", day: "numeric" },
                );
                return (
                  <section
                    key={date}
                    aria-label={dateLabel}
                    className={cn(
                      "relative min-w-0",
                      view === "agenda" && "p-4 sm:flex sm:items-start sm:gap-5",
                      view !== "agenda" &&
                        "border-e border-b border-foreground/10 p-1 sm:p-2 [&:nth-child(7n)]:border-e-0",
                      view === "month" && "min-h-16 sm:min-h-20",
                      view === "week" && "min-h-32 sm:min-h-96",
                      isSelected && "bg-primary/[0.045] ring-1 ring-inset ring-primary/40",
                      date.slice(0, 7) !== anchor.slice(0, 7) &&
                        view === "month" &&
                        !isSelected &&
                        "bg-black/10",
                    )}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      try {
                        const [publicationId, destinationId] = e.dataTransfer
                          .getData("text/plain")
                          .split("/");
                        const p = data.publications.find(
                            (p) => p.id === publicationId,
                          ),
                          d = p?.destinations.find(
                            (d) => d.id === destinationId,
                          );
                        if (
                          !p ||
                          !d ||
                          !["not_sent", "failed", "scheduled"].includes(d.state)
                        )
                          return;
                        const before = d.confirmedAt ?? intendedTime(p, d);
                        if (!before) return;
                        const time = new Intl.DateTimeFormat("en-GB", {
                          timeZone: data.settings.timezone,
                          hour: "2-digit",
                          minute: "2-digit",
                          hourCycle: "h23",
                        }).format(new Date(before));
                        setMove({
                          publicationId,
                          destinationId,
                          before,
                          after: localInstant(
                            date,
                            time,
                            data.settings.timezone,
                          ),
                        });
                        setMoveError("");
                      } catch (error) {
                        setMoveError((error as Error).message);
                      }
                    }}
                  >
                    <button
                      aria-label={`Show publications for ${dateLabel}`}
                      aria-pressed={isSelected}
                      aria-current={date === today ? "date" : undefined}
                      aria-controls="selected-day-publications"
                      onClick={() => setDay(date)}
                      className={cn(
                        "mb-1 flex min-h-8 min-w-8 items-center justify-center rounded-full px-2 text-xs tabular-nums transition-colors hover:bg-foreground/10 focus-visible:outline-2 focus-visible:outline-primary motion-reduce:transition-none sm:min-h-9 sm:min-w-9",
                        view === "agenda" && "shrink-0 justify-start text-sm font-medium sm:w-40",
                        view === "month" && date.slice(0, 7) !== anchor.slice(0, 7) && "text-muted-foreground",
                        date === today &&
                          "bg-primary text-primary-foreground hover:bg-primary/90",
                      )}
                    >
                      {view === "agenda"
                        ? new Date(`${date}T12:00:00`).toLocaleDateString(
                            undefined,
                            { weekday: "long", month: "short", day: "numeric" },
                          )
                        : Number(date.slice(-2))}
                    </button>
                    <div
                      className={cn(
                        "min-w-0 space-y-1.5",
                        view === "agenda" && "flex-1",
                        view !== "agenda" && "hidden sm:block",
                      )}
                    >
                      {entries.map((p) => (
                        <CalendarEntry
                          key={p.id}
                          compact={view !== "agenda"}
                          publication={p}
                          date={date}
                          data={data}
                          onOpen={() => showPublication(p.id)}
                        />
                      ))}
                      {!entries.length && view === "week" && (
                        <p className="px-1 pt-4 text-xs text-muted-foreground">
                          No publications
                        </p>
                      )}
                    </div>
                    {!!entries.length && view !== "agenda" && (
                      <p className="text-center text-xs text-muted-foreground sm:hidden">
                        {entries.length}
                        <span className="sr-only"> publications</span>
                      </p>
                    )}
                  </section>
                );
              })}
              {view === "agenda" && !visibleDays.length && (
                <div className="flex min-h-80 flex-col items-center justify-center px-6 py-12 text-center">
                  <span className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-foreground/5">
                    <CalendarDays className="size-6 text-muted-foreground" strokeWidth={1.5} aria-hidden />
                  </span>
                  <h3 className="text-base font-medium">
                    {hasFilters ? "No publications match these filters" : "No publications this week"}
                  </h3>
                  <p className="mt-2 max-w-sm text-sm text-pretty text-muted-foreground">
                    {hasFilters
                      ? "Try another account or status to see more publications."
                      : "Prepare a video in the editor, then choose when to publish it."}
                  </p>
                  {hasFilters ? (
                    <Button className="mt-5" variant="outline" onClick={clearFilters}>
                      Clear filters
                    </Button>
                  ) : (
                    <Button className="mt-5" variant="outline" nativeButton={false} render={<Link href="/" />}>
                      Open projects
                      <ArrowUpRight className="size-4" aria-hidden />
                    </Button>
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>Select a day to review its publications.</span>
            <span role="status">
              {scheduledCount} {scheduledCount === 1 ? "publication" : "publications"} on the calendar
            </span>
          </div>
          {(offset > 0 || data.nextOffset != null) && <div className="flex flex-wrap gap-2">
            {offset > 0 && (
              <Button
                variant="outline"
                onClick={() => setOffset(Math.max(0, offset - 100))}
              >
                Previous publications
              </Button>
            )}
            {data.nextOffset != null && (
              <Button
                variant="outline"
                onClick={() => setOffset(data.nextOffset!)}
              >
                More publications
              </Button>
            )}
          </div>}
        </section>

        <aside className="grid min-w-0 gap-5 sm:grid-cols-2 lg:grid-cols-1">
          <section
            id="selected-day-publications"
            aria-labelledby="selected-day-heading"
            className="rounded-3xl bg-card p-5 ring-1 ring-foreground/10"
          >
            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <p>{day === today ? "Today" : "Selected day"}</p>
              <CalendarDays className="size-4" aria-hidden />
            </div>
            <h2 id="selected-day-heading" aria-live="polite" className="mt-2 mb-5 text-lg font-medium tracking-tight">
              {new Date(`${day}T12:00:00`).toLocaleDateString(undefined, {
                weekday: "short",
                month: "long",
                day: "numeric",
              })}
            </h2>
            <div className="space-y-3">
              {selectedDayEntries.map((p) => (
                <CalendarEntry
                  key={p.id}
                  publication={p}
                  date={day}
                  data={data}
                  onOpen={() => showPublication(p.id)}
                />
              ))}
            </div>
            {!selectedDayEntries.length && (
              <div className="rounded-2xl bg-foreground/[0.035] px-4 py-5">
                <p className="text-sm font-medium">Nothing scheduled</p>
                <p className="mt-1 text-xs leading-relaxed text-pretty text-muted-foreground">
                  {unscheduled.length > 0
                    ? "Open a video from Unscheduled to choose its publishing time."
                    : "Your planned publications will appear here."}
                </p>
              </div>
            )}
          </section>
          <section className="rounded-3xl bg-card p-5 ring-1 ring-foreground/10">
            <div className="mb-4 flex items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 text-sm font-medium">
                <Inbox className="size-4" aria-hidden />
                Unscheduled
              </h2>
              <span className="text-xs text-muted-foreground tabular-nums">
                {unscheduled.length}
              </span>
            </div>
            {!unscheduled.length && (
              <>
                <p className="text-sm font-medium">
                  {hasFilters ? "No matching videos" : "Start with a video"}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {hasFilters
                    ? "Clear the filters to see all unscheduled videos."
                    : "Open a video in the editor and prepare a publication. It will appear here, ready to schedule."}
                </p>
                {hasFilters ? (
                  <Button className="mt-4" size="sm" variant="outline" onClick={clearFilters}>
                    Clear filters
                  </Button>
                ) : (
                  <Button
                    className="mt-4"
                    size="sm"
                    nativeButton={false}
                    render={<Link href="/" />}
                  >
                    Open projects
                    <ArrowUpRight className="size-3.5" aria-hidden />
                  </Button>
                )}
              </>
            )}
            <div className="space-y-3">
              {unscheduled.map((p) => (
                <div key={p.id} className="flex items-start gap-2">
                  <Checkbox
                    aria-label={`Select ${p.label}`}
                    checked={selected.includes(p.id)}
                    onCheckedChange={(checked) =>
                      setSelected(
                        checked
                          ? [...selected, p.id]
                          : selected.filter((id) => id !== p.id),
                      )
                    }
                  />
                  <div className="min-w-0 flex-1">
                    <button
                      className="min-h-9 w-full break-words text-left text-sm font-medium hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                      onClick={() => showPublication(p.id)}
                    >
                      {p.label}
                    </button>
                    <PublicationStatusBadge status={p.status} />
                  </div>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Edit ${p.label}`}
                    nativeButton={false}
                    render={
                      <Link
                        href={`/p/${p.projectId}/edit?sequence=${p.sequenceId}`}
                      />
                    }
                  >
                    <ArrowUpRight className="size-4" />
                  </Button>
                </div>
              ))}
            </div>
            {selected.length > 0 && (
              <div className="mt-4 space-y-2 border-t border-foreground/10 pt-4">
                <p className="text-xs text-muted-foreground">
                  {selected.length} selected
                </p>
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    void run({
                      tool: "publication.slots",
                      ids: selected,
                      from: anchor,
                      days: 30,
                      reserve: true,
                      revisions,
                    })
                  }
                >
                  Find publishing times
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setSelected([])}
                >
                  Clear selection
                </Button>
              </div>
            )}
          </section>
          {!!phoneDue.length && (
            <Disclosure summary="iPhone preparation" aside={phoneDue.length}>
              <p className="mb-3 text-xs text-muted-foreground">
                Keep your iPhone nearby and open Mirroring to prepare these
                videos.
              </p>
              {phoneDue.map((p) => (
                <Button
                  className="mb-2 max-w-full"
                  key={p.id}
                  size="sm"
                  variant="outline"
                  onClick={() => showPublication(p.id)}
                >
                  <Smartphone className="size-3.5" aria-hidden />
                  <span className="truncate">{p.label}</span>
                </Button>
              ))}
            </Disclosure>
          )}
          {data.connections.some((c) => c.provider !== "iphone") && (
            <Disclosure summary="Calendar sync">
              <p className="mb-3 text-xs text-muted-foreground">
                Available times include the latest provider schedules. Check
                changes made directly in mobile apps.
              </p>
              {data.connections
                .filter((c) => c.provider !== "iphone")
                .map((c) => {
                  const snapshot = data.externalCalendars?.find(
                    (s) => s.connectionId === c.id,
                  );
                  return (
                    <div key={c.id} className="mb-3 space-y-1">
                      <p className="text-sm">{c.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {snapshot
                          ? `Checked ${new Date(snapshot.checkedAt).toLocaleString()}`
                          : "Not synced yet"}
                      </p>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() =>
                          void run({
                            tool: "publishing.calendar.sync",
                            connectionId: c.id,
                          })
                        }
                      >
                        Refresh calendar
                      </Button>
                    </div>
                  );
                })}
            </Disclosure>
          )}
        </aside>
      </div>
      {moveError && (
        <p role="alert" className="text-sm text-destructive">
          {moveError}
        </p>
      )}
      <Dialog
        open={!!move}
        onOpenChange={(open) => {
          if (!open) setMove(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change publication time?</DialogTitle>
            <DialogDescription>
              This updates the selected destination. For an iPhone schedule,
              cancel and verify the old time first.
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm">
            From{" "}
            {move &&
              new Date(move.before).toLocaleString(undefined, {
                timeZone: data.settings.timezone,
              })}
            <br />
            To{" "}
            {move &&
              new Date(move.after).toLocaleString(undefined, {
                timeZone: data.settings.timezone,
              })}
          </p>
          <Button
            disabled={busy}
            onClick={async () => {
              if (!move) return;
              const p = data.publications.find(
                  (p) => p.id === move.publicationId,
                ),
                d = p?.destinations.find((d) => d.id === move.destinationId);
              if (!p || !d) return;
              const result = await run(
                d.state === "scheduled"
                  ? {
                      tool: "publication.move",
                      id: p.id,
                      revision: p.revision,
                      destinationId: d.id,
                      at: move.after,
                    }
                  : {
                      tool: "publication.patch",
                      id: p.id,
                      revision: p.revision,
                      patch: {},
                      destinations: p.destinations.map((dest) =>
                        dest.id === d.id
                          ? { ...dest, scheduledAt: move.after }
                          : dest,
                      ),
                    },
              );
              if (result) setMove(null);
            }}
          >
            Confirm time change
          </Button>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!current}
        onOpenChange={(value) => {
          if (!value && !dirty && !busy) setOpen(null);
        }}
      >
        <DialogContent
          showCloseButton={!dirty && !busy}
          className="max-h-[92dvh] w-[min(70rem,96vw)] overflow-y-auto rounded-3xl sm:max-w-[70rem]"
        >
          <DialogHeader>
            <DialogTitle>{current?.label ?? "Publication"}</DialogTitle>
            <DialogDescription>
              Review your video, tailor the text and choose when it goes live.
            </DialogDescription>
          </DialogHeader>
          {current && (
            <PublicationForm
              key={current.id}
              publication={current}
              data={data}
              run={run}
              busy={busy}
              onDirtyChange={setDirty}
            />
          )}
        </DialogContent>
      </Dialog>
    </main>
  );
}

function CalendarEntry({
  publication: p,
  date,
  data,
  onOpen,
  compact = false,
}: {
  compact?: boolean;
  publication: PublicationDetail;
  date: string;
  data: PublishingOverview;
  onOpen: () => void;
}) {
  const destinations = p.destinations.filter((d) => {
    const at = d.confirmedAt ?? intendedTime(p, d);
    return at && dayInZone(at, data.settings.timezone) === date;
  });
  return (
    <article className="min-w-0 rounded-[12px] bg-foreground/[0.055] p-2 ring-1 ring-foreground/5">
      <button
        className="flex w-full items-start gap-2 rounded-lg text-left focus-visible:outline-2 focus-visible:outline-ring"
        onClick={onOpen}
      >
        <span className={cn(
          "flex shrink-0 items-center justify-center overflow-hidden rounded-[6px] bg-black/30",
          compact ? "size-6" : "size-8",
        )}>
          {p.artifact ? (
            <video
              src={`/api/publishing/artifact/${p.artifact.id}#t=0.1`}
              preload="metadata"
              muted
              playsInline
              aria-hidden
              className="size-full object-cover"
            />
          ) : (
            <Film className="size-4 text-muted-foreground" aria-hidden />
          )}
        </span>
        <span
          title={p.label}
          className={cn(
            "min-w-0 break-words text-xs font-medium leading-snug",
            compact && "line-clamp-2",
          )}
        >
          {p.label}
        </span>
      </button>
      <div className="mt-2">
        <PublicationStatusBadge status={p.status} />
      </div>
      {compact && destinations[0] && (
        <p className="mt-2 text-[11px] text-muted-foreground tabular-nums">
          {new Date(
            (destinations[0].confirmedAt ?? intendedTime(p, destinations[0]))!,
          ).toLocaleTimeString(undefined, {
            timeZone: data.settings.timezone,
            hour: "2-digit",
            minute: "2-digit",
          })}
        </p>
      )}
      <div className={compact ? "mt-1 flex flex-wrap gap-2" : "space-y-1"}>
        {destinations.map((d) => (
          <p
            key={d.id}
            draggable={["not_sent", "failed", "scheduled"].includes(d.state)}
            onDragStart={(e) =>
              e.dataTransfer.setData("text/plain", `${p.id}/${d.id}`)
            }
            className="mt-1 break-words text-xs leading-relaxed text-muted-foreground"
          >
            {compact ? (
              <span
                title={data.accounts.find((a) => a.id === d.accountId)?.name}
              >
                {data.accounts.find((a) => a.id === d.accountId) && (
                  <NetworkIcon
                    network={
                      data.accounts.find((a) => a.id === d.accountId)!.network
                    }
                    className="size-3.5"
                  />
                )}
                <span className="sr-only">
                  {data.accounts.find((a) => a.id === d.accountId)?.network}
                </span>
              </span>
            ) : (
              <>
                {data.accounts.find((a) => a.id === d.accountId) &&
                  NETWORK_LABELS[
                    data.accounts.find((a) => a.id === d.accountId)!.network
                  ]}{" "}
                ·{" "}
                {new Date(
                  (d.confirmedAt ?? intendedTime(p, d))!,
                ).toLocaleTimeString(undefined, {
                  timeZone: data.settings.timezone,
                  hour: "2-digit",
                  minute: "2-digit",
                })}
                {!d.confirmedAt && (
                  <span className="block text-[11px]">Time reserved</span>
                )}
              </>
            )}
          </p>
        ))}
      </div>
    </article>
  );
}
