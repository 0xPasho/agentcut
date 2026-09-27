"use client";
import { useCallback, useEffect, useState } from "react";
import type { CalendarQuery, PublishingOverview, PublishingRun } from "./types";

export function usePublishing(projectId?: string, initial?: PublishingOverview, range?: Pick<CalendarQuery, "from" | "to" | "offset">) {
  const [data, setData] = useState<PublishingOverview | undefined>(initial), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const query = range ? `?from=${range.from}&to=${range.to}&offset=${range.offset}` : projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
  const reload = useCallback(async () => {
    const response = await fetch(`/api/publishing${query}`);
    if (!response.ok) throw new Error("Unable to load publications");
    setData(await response.json());
  }, [query]);
  useEffect(() => { void reload().catch(e => setError(e.message)); const interval = setInterval(() => { void reload().catch(() => {}); }, 5000); return () => clearInterval(interval); }, [reload]);
  const run: PublishingRun = useCallback(async <T,>(input: unknown): Promise<T | undefined> => {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/publishing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error ?? "Publication action failed");
      await reload(); return result as T;
    } catch (e) { setError((e as Error).message); return undefined; }
    finally { setBusy(false); }
  }, [reload]);
  return { data, error, busy, run, reload };
}
