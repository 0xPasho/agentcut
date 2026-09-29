"use client";
import { useState } from "react";
import { api } from "../../../common/api/client";
import type { SnapshotExport, SnapshotImport, SnapshotPreview } from "../types";

export function useWorkspaceSnapshot() {
  const [pending, setPending] = useState("");
  const [error, setError] = useState("");
  const [exported, setExported] = useState<SnapshotExport | null>(null);
  const [imported, setImported] = useState<SnapshotImport | null>(null);
  const [candidate, setCandidate] = useState<{ id: string; preview: SnapshotPreview } | null>(null);
  async function run(label: string, action: () => Promise<void>) {
    setPending(label); setError("");
    try { await action(); } catch (e) { setError((e as Error).message); } finally { setPending(""); }
  }
  return {
    pending, error, exported, imported, candidate,
    exportFile: () => run("export", async () => { setExported(null); setExported(await api.exportSnapshot()); }),
    inspect: (file: File) => run("inspect", async () => { setCandidate(null); setImported(null); setCandidate(await api.previewSnapshot(file)); }),
    restore: () => run("restore", async () => {
      if (!candidate) return;
      setImported(await api.restoreSnapshot(candidate.id, candidate.preview.fingerprint)); setCandidate(null);
    }),
    cancel: () => { setCandidate(null); setError(""); },
  };
}
