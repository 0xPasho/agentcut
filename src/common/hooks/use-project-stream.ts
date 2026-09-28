"use client";
import { useSyncExternalStore } from "react";
import type { JobState } from "../api/client";
import { type ProjectStream, type ProjectEvents, type Entry } from "../api/types";

const EMPTY: ProjectStream = { events: [], name: null, status: null, error: null, revision: 0, job: null, connected: false };
/** Enough to scroll back through a long run without growing without bound. */
const MAX_EVENTS = 400;
/** A remount (React's strict double-render, a tab switch) should not restart the feed. */
const LINGER_MS = 5_000;
/** As often as the editor polls the revision; a run's lines are seconds apart. */
const POLL_MS = 1_000;

const streams = new Map<string, Entry>();

function publish(entry: Entry, next: Partial<ProjectStream>) {
  entry.snapshot = { ...entry.snapshot, ...next };
  for (const listener of entry.listeners) listener();
}

/**
 * Polled, never streamed: a held-open connection per tab is what filled the browser's
 * six sockets for this host and left every later page load waiting on "Rendering".
 * Each poll is a short request that gives its socket back.
 */
function open(projectId: string): Entry {
  let stopped = false;
  let inFlight = false;
  const entry: Entry = { refs: 0, snapshot: { ...EMPTY }, listeners: new Set(), cursor: 0, stop: () => {} };

  const poll = async () => {
    if (stopped || inFlight) return;
    inFlight = true;
    clearTimeout(entry.timer);
    try {
      const res = await fetch(`/api/projects/${projectId}/events?since=${entry.cursor}`, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json() as ProjectEvents;
      if (stopped) return;
      entry.cursor = data.cursor;
      const seen = new Set(entry.snapshot.events.map((e) => e.id));
      const fresh = data.events.filter((e) => !seen.has(e.id));
      const events = fresh.length ? [...entry.snapshot.events, ...fresh].slice(-MAX_EVENTS) : entry.snapshot.events;
      const s = entry.snapshot;
      const { name, status, revision, error, job } = data.status;
      const same = s.connected && !fresh.length && s.name === name && s.status === status && s.revision === revision && s.error === error && sameJob(s.job, job);
      if (!same) publish(entry, { events, name, status, revision, error, job, connected: true });
    } catch {
      if (!stopped && entry.snapshot.connected) publish(entry, { connected: false });
    } finally {
      inFlight = false;
      if (!stopped) entry.timer = setTimeout(poll, POLL_MS);
    }
  };

  // A hidden tab's timers are throttled to about once a minute; coming back to it has
  // to show what the agent did meanwhile at once.
  const resume = () => { if (document.visibilityState === "visible") void poll(); };
  document.addEventListener("visibilitychange", resume);
  window.addEventListener("focus", resume);
  entry.stop = () => {
    stopped = true;
    clearTimeout(entry.timer);
    document.removeEventListener("visibilitychange", resume);
    window.removeEventListener("focus", resume);
  };
  void poll();
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
      current.stop();
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
