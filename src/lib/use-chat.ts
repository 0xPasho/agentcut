"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, JOB_ACTIVE, type Attachment, type LogEvent, type Message, type MessageContext } from "./client";
import { useProjectStream } from "./use-project-stream";
import { isUrl } from "./urls";

/**
 * What a chat needs, whatever it is chatting about.
 *
 * The panel in the editor and the empty window on the home page are the same
 * component; they differ only in where the turns come from and what sending one
 * does. A controller is that difference, and nothing else, so a third surface is a
 * third controller rather than a second chat.
 */
export type ChatController = {
  /** Scopes the harness picker and the attachment uploads. Absent before a project exists. */
  projectId?: string;
  messages: Message[];
  events: LogEvent[];
  working: boolean;
  workingLabel: string;
  stage?: string | null;
  elapsed: number;
  progress?: number;
  /** The last turn was never answered and nothing is running. */
  interrupted: boolean;
  canStop: boolean;
  error: string;
  attachments: Attachment[];
  attaching: boolean;
  attach: (files: File[]) => void;
  removeAttachment: (id: string) => void;
  send: (text: string) => Promise<void>;
  stop?: () => void;
  undo?: (messageId: number) => void;
  placeholder: string;
  lockedReason?: string;
};

const JOB_LABELS: Record<string, string> = { edit: "Editing", analyze: "Analysing", render: "Rendering", transcribe: "Re-syncing the transcript", batch: "Running the batch" };
/** A run this long has either hung or is a big render; either way the owner deserves a way out. */
const STUCK_AFTER_SEC = 120;

/**
 * Dropped files become ordinary library assets, through the same upload the asset
 * browser uses. They are uploaded on drop rather than on send so the person can see
 * that the file arrived, and so a big video is not paid for twice.
 */
function useAttachments() {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [attaching, setAttaching] = useState(false);
  const [error, setError] = useState("");

  const attach = useCallback((files: File[]) => {
    if (!files.length) return;
    setAttaching(true); setError("");
    void (async () => {
      for (const file of files) {
        try {
          const { asset } = await api.uploadAsset(file);
          const kind = asset.kind as Attachment["kind"];
          setAttachments((prev) => (prev.some((a) => a.id === asset.id) ? prev : [...prev, { id: asset.id, name: asset.name ?? file.name, kind }]));
        } catch (e) { setError(`${file.name}: ${(e as Error).message}`); }
      }
      setAttaching(false);
    })();
  }, []);

  const removeAttachment = useCallback((id: string) => setAttachments((prev) => prev.filter((a) => a.id !== id)), []);
  const clear = useCallback(() => setAttachments([]), []);
  return { attachments, attaching, attach, removeAttachment, clear, attachError: error };
}

/** The elapsed seconds of whatever is running, from whichever start is known. */
function useElapsed(startedAt: number | null) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!startedAt) { setElapsed(0); return; }
    const tick = () => setElapsed(Math.max(0, Math.round((Date.now() - startedAt) / 1000)));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [startedAt]);
  return elapsed;
}

/** The conversation of a project that exists: the shared thread, and edits that run on it. */
export function useProjectChat(projectId: string, o: {
  beforeRun?: () => Promise<boolean>;
  afterUndo?: () => Promise<void>;
  context?: () => MessageContext;
} = {}): ChatController {
  const [messages, setMessages] = useState<Message[]>([]);
  const [pending, setPending] = useState(false);
  /** When this panel sent the open turn. Null after the reply lands, and on a reload. */
  const [sentAt, setSentAt] = useState<number | null>(null);
  const [error, setError] = useState("");
  const { attachments, attaching, attach, removeAttachment, clear, attachError } = useAttachments();

  const load = useCallback(async () => {
    try {
      const { messages } = await api.messages(projectId);
      setMessages(messages);
    } catch { /* transient */ }
  }, [projectId]);
  useEffect(() => { void load(); }, [load]);

  const last = messages[messages.length - 1];
  const unanswered = !!last && last.role === "user" && last.source !== "brief";
  useEffect(() => { if (!unanswered) setSentAt(null); }, [unanswered]);

  // The project holds one job at a time, and it can be started from anywhere — this
  // panel, a render, a terminal agent over MCP. The live stream carries both the job
  // and the run's own account of what it is doing.
  const stream = useProjectStream(projectId);
  const job = JOB_ACTIVE(stream.job) ? stream.job : null;
  // A turn left unanswered with no job behind it is not in progress — its process
  // died, or the app was closed mid-run. Spinning forever on it is a lie, and it locks
  // the composer for good.
  const working = pending || !!job || (unanswered && sentAt !== null);
  const elapsed = useElapsed(job?.createdAt ?? sentAt);

  useEffect(() => {
    if (!working) return;
    const timer = setInterval(load, 2000);
    return () => clearInterval(timer);
  }, [working, load]);
  // The agent's reply lands in the conversation table, not the stream: reload as soon
  // as the run ends rather than waiting out the next poll.
  const wasWorking = useRef(false);
  useEffect(() => {
    if (wasWorking.current && !job) void load();
    wasWorking.current = !!job;
  }, [job, load]);

  const send = useCallback(async (text: string) => {
    setPending(true); setError("");
    try {
      if (o.beforeRun && !(await o.beforeRun())) return;
      const current = await api.getProject(projectId);
      await api.agentEdit(projectId, text, current.revision, { ...(o.context?.() ?? {}), ...(attachments.length ? { attachments } : {}) });
      clear();
      setSentAt(Date.now());
      await load();
    } catch (e) { setError((e as Error).message); }
    finally { setPending(false); }
  }, [projectId, attachments, clear, load, o]);

  return {
    projectId,
    messages,
    events: stream.events,
    working,
    workingLabel: job ? JOB_LABELS[job.kind] ?? job.kind : "Working",
    stage: job?.stage,
    elapsed,
    progress: job?.progress,
    interrupted: unanswered && !working,
    canStop: elapsed >= STUCK_AFTER_SEC,
    error: error || attachError,
    attachments, attaching, attach, removeAttachment,
    send,
    stop: () => {
      setError("");
      api.unlockProject(projectId).then(load).catch((e) => setError((e as Error).message));
    },
    undo: (messageId: number) => {
      setError("");
      void (async () => {
        try {
          if (o.beforeRun && !(await o.beforeRun())) return;
          await api.undoMessage(projectId, messageId);
          await o.afterUndo?.();
          await load();
        } catch (e) { setError((e as Error).message); }
      })();
    },
    placeholder: messages.length ? "Shorter hook, and lower the music." : "Move the title to the bottom and lower the music volume.",
    lockedReason: job ? `${JOB_LABELS[job.kind] ?? job.kind} is running` : "a run is in progress",
  };
}

/** How the first message is read. The chat is the entry point, so it has to take all three. */
export function readStart(text: string, attachments: Attachment[]) {
  const link = text.split(/\s+/).find(isUrl) ?? null;
  const videos = attachments.filter((a) => a.kind === "video");
  return { link, videos, kind: link ? ("link" as const) : videos.length ? ("footage" as const) : ("canvas" as const) };
}

/** A name a person would recognise in a list, from the first thing they said. */
export const nameFromMessage = (text: string) => {
  const line = text.trim().split("\n")[0].replace(/\s+/g, " ");
  const short = line.length > 60 ? `${line.slice(0, 57)}…` : line;
  return short || "Untitled project";
};

/**
 * The chat with no project behind it yet.
 *
 * A message, a link or a dropped video are all legitimate ways to start: the first
 * turn decides which, creates the project through the same endpoints the cards on the
 * home page use, and hands the conversation over to the editor. Nothing is edited
 * here — this window's whole job is to turn what somebody said into a project that
 * already knows what they want.
 */
export function useStartChat(): ChatController {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [status, setStatus] = useState("");
  const [working, setWorking] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [error, setError] = useState("");
  const { attachments, attaching, attach, removeAttachment, attachError } = useAttachments();
  const elapsed = useElapsed(startedAt);

  const send = useCallback(async (text: string) => {
    setError(""); setWorking(true); setStartedAt(Date.now());
    // Shown as an ordinary turn straight away: the project it will belong to does not
    // exist yet, but the person has already said it.
    setMessages([{ id: Date.now(), role: "user", source: "web", text, sequenceId: null, context: attachments.length ? { attachments } : null, jobId: null, at: Date.now(), changes: null }]);
    try {
      const { link, videos, kind } = readStart(text, attachments);
      if (kind === "link") {
        setStatus("Fetching the video…");
        const project = await api.createProject(link!);
        setStatus("Finding clips…");
        await api.analyze(project.id, { userBrief: text });
        router.push(`/p/${project.id}`);
        return;
      }

      setStatus("Creating your project…");
      const created = await fetch("/api/projects/assemble", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: nameFromMessage(text) }),
      }).then(async (r) => { const data = await r.json(); if (!r.ok) throw new Error(data.error); return data as { id: string }; });

      // Dropped footage is imported before the first turn runs, so "cut this down"
      // means something the moment the agent reads the project.
      for (const video of videos) {
        setStatus(`Importing ${video.name}…`);
        const current = await api.getProject(created.id);
        await api.editorTool(created.id, { tool: "media.import", file: video.id, expectedRevision: current.revision });
      }

      setStatus("Starting the agent…");
      const current = await api.getProject(created.id);
      const images = attachments.filter((a) => a.kind !== "video");
      await api.agentEdit(created.id, text, current.revision, images.length ? { attachments: images } : undefined);
      router.push(`/p/${created.id}/edit`);
    } catch (e) {
      setError((e as Error).message);
      setWorking(false); setStartedAt(null); setStatus("");
    }
  }, [attachments, router]);

  return {
    messages,
    events: [],
    working,
    workingLabel: "Starting",
    stage: status || null,
    elapsed,
    interrupted: false,
    canStop: false,
    error: error || attachError,
    attachments, attaching, attach, removeAttachment,
    send,
    placeholder: "Make a 30-second explainer about our pricing, calm tone — or drop a video, or paste a link.",
  };
}
