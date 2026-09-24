"use client";
import { useId, useRef } from "react";
import { FileText, Loader2 } from "lucide-react";
import { Button } from "@/common/ui/button";
import { Label } from "@/common/ui/label";
import { count } from "@/common/lib/format";
import { useSourceTranscript } from "../hooks";
import { TRANSCRIPT_EXTENSIONS } from "../data";
import type { SourceTranscriptState } from "../types";

function sentence(state: SourceTranscriptState | null) {
  if (!state) return "";
  if (state.status === "none") return "Whisper transcribes the recording when the analysis starts.";
  if (state.status === "recognised") return "Whisper already transcribed this recording. The analysis reuses it.";
  const timing = state.timing === "words" ? "timed per word" : "timed per line and fitted to the speech";
  return `Using ${state.name}: ${count(state.words, "word", "words")}, ${timing}. Clips are chosen from these words.`;
}

/**
 * The transcript a person already has, as the words the analysis works from. A long
 * stream is exactly where they have one — from the platform, a captioning service or
 * their own notes — and trust it more than a recogniser's pass over five hours.
 */
export function SourceTranscript({ projectId, locked }: { projectId: string; locked: boolean }) {
  const { state, pending, error, add, discard } = useSourceTranscript(projectId);
  const input = useRef<HTMLInputElement>(null);
  const labelId = useId();
  const provided = state?.status === "provided";

  return (
    <div role="group" aria-labelledby={labelId} className="flex flex-col gap-2">
      <Label id={labelId} className="text-xs text-muted-foreground">Transcript</Label>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className="min-w-0 flex-1 text-sm text-pretty" aria-live="polite">
          {pending ? "Reading the transcript and placing its words…" : sentence(state)}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" disabled={locked || pending || !state} onClick={() => input.current?.click()}>
            {pending ? <Loader2 aria-hidden className="motion-safe:animate-spin" /> : <FileText aria-hidden />}
            {provided ? "Replace transcript" : "Add transcript"}
          </Button>
          {provided ? (
            <Button size="sm" variant="ghost" disabled={locked || pending} onClick={() => void discard()}>
              Use Whisper instead
            </Button>
          ) : null}
        </div>
      </div>
      <input
        ref={input}
        type="file"
        hidden
        accept={TRANSCRIPT_EXTENSIONS.join(",")}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void add(file);
        }}
      />
      {error ? <p role="alert" className="text-[11px] leading-snug text-destructive">{error}</p> : null}
      {provided ? null : (
        <p className="text-[11px] leading-snug text-muted-foreground">
          Have one already? SRT, VTT, JSON, or text where each line starts with a time. It replaces Whisper for this recording.
        </p>
      )}
    </div>
  );
}
