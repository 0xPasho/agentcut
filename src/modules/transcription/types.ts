import type { Segment, Word } from "./lib/transcript";

/** The shapes a transcript somebody already has can arrive in. */
export type TranscriptFormat = "srt" | "vtt" | "whisper.cpp" | "json" | "lines";

/**
 * A transcript read from someone else's file, before it is placed on the audio.
 * `words` is empty when the file is only timed per line: the words are then laid over
 * the speech inside each line, which needs the source's sound and so is not done here.
 */
export type ParsedTranscript = {
  format: TranscriptFormat;
  /** What the file says it is in, when it says; null when it does not. */
  language: string | null;
  segments: Segment[];
  words: Word[];
};

/**
 * What is kept next to a transcript that came from the person rather than from the
 * recogniser: where it came from and how finely it was timed. Both interfaces read it
 * to say which words the project is working from.
 */
export type ProvidedTranscript = {
  /** The file's name as it was handed over. */
  name: string;
  format: TranscriptFormat;
  /** `words` when the file timed every word; `segments` when the words were fitted to the speech. */
  timing: "words" | "segments";
  /**
   * For a file timed per line: the stretches of the source, in seconds, whose words have
   * since been given the times the recogniser hears them at. Those are the stretches a
   * timeline uses; everywhere else the words keep the place their line gave them.
   */
  timed?: Array<{ start: number; end: number }>;
  /**
   * How `timed` was heard. A stretch heard another way is heard again: the way it was
   * heard is what put its words where they are.
   */
  heardWith?: string;
  words: number;
  segments: number;
  /** When it was imported, epoch ms. */
  at: number;
  /** Who imported it: "" a person, "agent:<id>" a turn, "cli" the command line. */
  by: string;
};

/** Where the words of a project's own source come from. */
export type SourceTranscriptState =
  | { status: "none" }
  | { status: "recognised"; engine: string }
  | ({ status: "provided"; engine: string } & ProvidedTranscript);
