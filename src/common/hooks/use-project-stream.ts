"use client";
import { useSyncExternalStore } from "react";
import type { JobState, LogEvent } from "../api/client";
import { type ProjectStream, type Entry } from "../api/types";

const EMPTY: ProjectStream = { events: [], status: null, error: null, revision: 0, job: null, connected: false };
/** Enough to scroll back through a long run without growing without bound. */
const MAX_EVENTS = 400;
/** A remount (React's strict double-render, a tab switch) should not drop the stream. */
const LINGER_MS = 5_000;

const streams = new Map<string, Entry>();

function publish(entry: Entry, next: Partial<ProjectStream>) {
  entry.snapshot = { ...entry.snapshot, ...next };
  for (const listener of entry.listeners) listener();
}

function open(projectId: string): Entry {
  const source = new EventSource(`/api/projects/${projectId}/events`);
  const entry: Entry = { source, refs: 0, snapshot: { ...EMPTY }, listeners: new Set() };

  source.addEventListener("log", (e) => {
    const data = JSON.parse((e as MessageEvent).data) as LogEvent;
    const events = entry.snapshot.events;
    if (events.some((p) => p.id === data.id)) return;
    publish(entry, { events: [...events, data].slice(-MAX_EVENTS), connected: true });
  });
  source.addEventListener("status", (e) => {
    const data = JSON.parse((e as MessageEvent).data) as { status: string; revision: number; error: string | null; job: JobState | null };
    const s = entry.snapshot;
    if (s.connected && s.status === data.status && s.revision === data.revision && s.error === data.error && sameJob(s.job, data.job)) return;
    publish(entry, { status: data.status, revision: data.revision, error: data.error, job: data.job, connected: true });
  });
  source.addEventListener("error", () => publish(entry, { connected: false }));
  return entry;
}

const sameJob = (a: JobState | null, b: JobState | null) =>
  a === b || (!!a && !!b && a.id === b.id && a.status === b.status && a.stage === b.stage && a.progress === b.progress);

function subscribe(projectId: string, listener: () => void) {
  let entry = streams.get(projectId);
  if (!entry) streams.set(projectId, (entry = open(projectId)));
  if (entry.closing) { clearTimeout(entry.closing); entry.closing = undefined; }
  entry.refs += 1;
  entry.listeners.add(listener);
  return () => {
    const current = streams.get(projectId);
    if (!current) return;
    current.listeners.delete(listener);
    current.refs -= 1;
    if (current.refs > 0) return;
    current.closing = setTimeout(() => {
      if (current.refs > 0) return;
      current.source.close();
      streams.delete(projectId);
    }, LINGER_MS);
  };
}

/** What the project is doing, live. Safe to call from as many components as need it. */
export function useProjectStream(projectId: string): ProjectStream {
  return useSyncExternalStore(
    (listener) => subscribe(projectId, listener),
    () => streams.get(projectId)?.snapshot ?? EMPTY,
    () => EMPTY,
  );
}
