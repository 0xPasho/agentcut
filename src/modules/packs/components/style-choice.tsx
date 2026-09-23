"use client";
import { useCallback, useEffect, useId, useState } from "react";
import { api } from "@/common/api/client";
import { Label } from "@/common/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/common/ui/select";
import type { ActiveStyleView, InstalledPack } from "../types";
import { AUTO_STYLE } from "../data";

/**
 * Which pack's style guide this project's videos are made to. `style.active` and
 * `style.choose` are the tools an agent calls for the same thing.
 */
export function StyleChoice({ projectId, sequenceId }: { projectId: string; sequenceId?: string }) {
  const id = useId();
  const [active, setActive] = useState<ActiveStyleView | null>(null);
  const [packs, setPacks] = useState<InstalledPack[]>([]);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const [style, installed] = await Promise.all([
        api.editorTool<ActiveStyleView>(projectId, { tool: "style.active", sequenceId }),
        api.editorTool<InstalledPack[]>(projectId, { tool: "packs.list" }),
      ]);
      setActive(style);
      setPacks(installed);
    } catch (reason) { setError((reason as Error).message); }
  }, [projectId, sequenceId]);
  useEffect(() => { void load(); }, [load]);

  const choose = async (value: string) => {
    setError("");
    try {
      await api.editorTool(projectId, { tool: "style.choose", pack: value === AUTO_STYLE ? null : value });
      await load();
    } catch (reason) { setError((reason as Error).message); }
  };

  if (!active) return <p className="text-xs text-muted-foreground">{error || "Reading the style guide…"}</p>;
  const labels: Record<string, string> = { [AUTO_STYLE]: "Decide on its own", none: "None", ...Object.fromEntries(packs.map((p) => [p.id, p.name])) };

  return (
    <div className="space-y-2">
      <Label id={`${id}-label`}>Style guide</Label>
      <Select value={active.choice ?? AUTO_STYLE} onValueChange={(value) => void choose(String(value))}>
        <SelectTrigger aria-labelledby={`${id}-label`} className="w-full"><SelectValue>{(value: unknown) => labels[String(value)] ?? String(value)}</SelectValue></SelectTrigger>
        <SelectContent>{Object.entries(labels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">{active.pack ? `Using ${active.name}. ` : ""}{active.reason}</p>
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
