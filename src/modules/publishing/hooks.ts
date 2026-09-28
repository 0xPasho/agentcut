"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CalendarQuery, PublishingOverview, PublishingRun } from "./types";

export function usePublishing(projectId?: string, initial?: PublishingOverview, range?: Pick<CalendarQuery, "from" | "to" | "offset">) {
  const [data, setData] = useState<PublishingOverview | undefined>(initial), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const params = new URLSearchParams();
  if (projectId) params.set("projectId", projectId);
  if (range) {
    params.set("from", range.from);
    params.set("to", range.to);
    params.set("offset", String(range.offset));
  }
  const query = params.size ? `?${params}` : "";
  const loading = useRef(0), running = useRef(false);
  const reload = useCallback(async () => {
    const request = ++loading.current;
    const response = await fetch(`/api/publishing${query}`);
    if (!response.ok) throw new Error("Unable to load publications");
    const result = await response.json();
    if (request === loading.current) setData(result);
  }, [query]);
  useEffect(() => { void reload().catch(e => setError(e.message)); const interval = setInterval(() => { void reload().catch(() => {}); }, 5000); return () => clearInterval(interval); }, [reload]);
  const run: PublishingRun = useCallback(async <T,>(input: unknown): Promise<T | undefined> => {
    if (running.current) return undefined;
    running.current = true;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/publishing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error ?? "Publication action failed");
      await reload().catch(() => setError("Changes saved. Refresh the calendar to see the latest records."));
      return result as T;
    } catch (e) { setError((e as Error).message); return undefined; }
    finally { running.current = false; setBusy(false); }
  }, [reload]);
  return { data, error, busy, run, reload };
}
