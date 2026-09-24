"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "../../common/api/client";
import type { SourceTranscriptState } from "./types";

/**
 * Where the source's words come from, and the two things a person can do about it.
 * Read and written through the same tools the agent calls, so the panel cannot show
 * a state the agent does not see.
 */
export function useSourceTranscript(projectId: string) {
  const [state, setState] = useState<SourceTranscriptState | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const read = useCallback(async () => {
    const report = await api.editorTool<{ source: SourceTranscriptState }>(projectId, { tool: "media.transcription" });
    setState(report.source);
  }, [projectId]);
  useEffect(() => { void read().catch(() => {}); }, [read]);

  const act = async (call: () => Promise<unknown>) => {
    setPending(true);
    setError("");
    try {
      await call();
      await read();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  };

  return {
    state,
    pending,
    error,
    add: (file: File) => act(async () => api.editorTool(projectId, { tool: "transcript.import", text: await file.text(), name: file.name })),
    discard: () => act(() => api.editorTool(projectId, { tool: "transcript.discard" })),
  };
}
