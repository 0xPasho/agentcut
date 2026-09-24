"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, JOB_ACTIVE, type Attachment, type Message, type MessageContext } from "../../../common/api/client";
import { useProjectStream } from "../../../common/hooks/use-project-stream";
import { isUrl } from "../../../common/lib/urls";
import { type ChatController, type QueuedMessage, type StartOptions } from "../types";

const JOB_LABELS: Record<string, string> = { edit: "Editing", analyze: "Analysing", render: "Rendering", transcribe: "Re-syncing the transcript", batch: "Running the batch" };

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
  /**
   * What was typed while the run was going. A project takes one job at a time, which
   * is a fact about the editor and not a reason to make somebody sit and watch before
   * they are allowed to say the next thing. They go in order, each one still removable
   * until it is its turn.
   */
  const [queued, setQueued] = useState<QueuedMessage[]>([]);
  /** A queued send that failed holds the rest back: one wall is enough. */
  const held = useRef(false);
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
  // Until the stream has said what this project is running, an unanswered turn is
  // unknown, not dead: the editor opened straight from the home screen was telling
  // people their run had died while the agent was still working on it.
  const working = pending || !!job || (unanswered && (sentAt !== null || !stream.connected));
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

  /** Actually start a turn. Everything else decides when this is allowed to happen. */
  const dispatch = useCallback(async (text: string, files: Attachment[]) => {
    setPending(true); setError("");
    try {
      if (o.beforeRun && !(await o.beforeRun())) return false;
      const current = await api.getProject(projectId);
      await api.agentEdit(projectId, text, current.revision, { ...(o.context?.() ?? {}), ...(files.length ? { attachments: files } : {}) });
      setSentAt(Date.now());
      await load();
      return true;
    } catch (e) { setError((e as Error).message); return false; }
    finally { setPending(false); }
  }, [projectId, load, o]);

  const send = useCallback(async (text: string) => {
    held.current = false;
    // Whatever is on the composer goes with this message, queued or not; the box is
    // emptied here rather than in `dispatch`, because a queued turn going out must not
    // take away the file somebody has just attached for the next one.
    const files = attachments;
    if (working) {
      setQueued((prev) => [...prev, { id: Date.now() + prev.length, text, attachments: files }]);
      clear();
      return;
    }
    if (await dispatch(text, files)) clear();
  }, [working, attachments, clear, dispatch]);

  // The queue drains itself the moment the project is free again, oldest first.
  useEffect(() => {
    if (working || pending || held.current || !queued.length) return;
    const [next, ...rest] = queued;
    setQueued(rest);
    void (async () => {
      const sent = await dispatch(next.text, next.attachments);
      // Put it back rather than losing what somebody wrote, and stop the queue there:
      // whatever refused this one will refuse the rest a second later.
      if (!sent) { held.current = true; setQueued((prev) => [next, ...prev]); }
    })();
  }, [working, pending, queued, dispatch]);

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
    // Stopping is a real cancellation now — the job's signal kills the harness — so it
    // is offered from the first second rather than after a two-minute wait.
    canStop: working,
    error: error || attachError,
    attachments, attaching, attach, removeAttachment,
    queued,
    cancelQueued: (id: number) => { held.current = false; setQueued((prev) => prev.filter((m) => m.id !== id)); },
    send,
    stop: () => {
      setError("");
      setSentAt(null);
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

export function useStartChat(start: () => StartOptions = () => ({})): ChatController {
  const router = useRouter();
  // Read at send time, not at render time: the shape can change while the box is open.
  const options = useRef(start);
  options.current = start;
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
      const { aspect, templateIds = [] } = options.current();
      /**
       * The chosen templates are the project's, from before its first edit: ordinary plan
       * fields, so the agent reads them and the editor shows them. One is the project's
       * look; several are a shortlist each video chooses from.
       */
      const chooseTemplate = async (projectId: string) => {
        if (!templateIds.length) return;
        const current = await api.getProject(projectId);
        await api.editorTool(projectId, { tool: "project.edit", expectedRevision: current.revision,
          operations: [{ type: "plan.patch", patch: { templates: templateIds, template: templateIds.length === 1 ? templateIds[0] : null } }] });
      };
      if (kind === "link") {
        setStatus("Fetching the video…");
        const project = await api.createProject(link!);
        await chooseTemplate(project.id);
        setStatus("Finding clips…");
        await api.analyze(project.id, { userBrief: text });
        router.push(`/p/${project.id}`);
        return;
      }

      setStatus("Creating your project…");
      const created = await fetch("/api/projects/assemble", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: nameFromMessage(text), ...(aspect ? { aspect } : {}) }),
      }).then(async (r) => { const data = await r.json(); if (!r.ok) throw new Error(data.error); return data as { id: string }; });
      await chooseTemplate(created.id);

      // Dropped footage is imported before the first turn runs, so "cut this down"
      // means something the moment the agent reads the project — and it is placed on the
      // timeline in the order it was dropped, so the project opens with a video in it
      // rather than with media nobody put anywhere.
      for (const video of videos) {
        setStatus(`Importing ${video.name}…`);
        const current = await api.getProject(created.id);
        const sequenceId = current.edl?.sequences[0]?.id;
        await api.editorTool(created.id, { tool: "media.import", file: video.id, expectedRevision: current.revision,
          ...(sequenceId ? { place: { sequenceId, at: null, layer: 0 } } : {}) });
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
