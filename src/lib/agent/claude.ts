import { which } from "../bin";
import { spawnStream, makeEvent } from "./spawn";
import type { AgentEvent, AgentProvider, AgentResult, AgentRunOptions } from "./types";

/**
 * Claude Code in headless mode.
 *
 * Deliberately NOT using --dangerously-skip-permissions: transcripts come from
 * third-party video and are attacker-controlled text. Tools are allowlisted and
 * `dontAsk` denies everything else instead of hanging on a prompt.
 */
export const claudeProvider: AgentProvider = {
  id: "claude",
  label: "Claude Code",

  async available() {
    return (await which("claude")) !== null;
  },

  async run(opts: AgentRunOptions): Promise<AgentResult> {
    const started = Date.now();
    const events: AgentEvent[] = [];
    const emit = (e: AgentEvent) => {
      events.push(e);
      opts.onEvent?.(e);
    };

    const args = [
      "-p", opts.prompt,
      "--output-format", "stream-json",
      "--verbose",
      "--permission-mode", "dontAsk",
      "--add-dir", opts.cwd,
    ];
    if (opts.allowedTools?.length) args.push("--allowed-tools", opts.allowedTools.join(" "));
    if (opts.model) args.push("--model", opts.model);

    let text = "";
    let costUsd: number | undefined;
    let sessionId: string | undefined;

    const res = await spawnStream("claude", args, {
      cwd: opts.cwd,
      timeoutMs: opts.timeoutMs ?? 15 * 60_000,
      onStderr: (c) => emit(makeEvent("log", c)),
      onLine: (line) => {
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(line);
        } catch {
          emit(makeEvent("log", line));
          return;
        }
        sessionId ??= msg.session_id as string | undefined;

        if (msg.type === "assistant") {
          const content = (msg.message as { content?: Array<Record<string, unknown>> })?.content ?? [];
          for (const block of content) {
            if (block.type === "text" && typeof block.text === "string") {
              emit(makeEvent("text", block.text));
            } else if (block.type === "tool_use") {
              emit(makeEvent("tool", summarizeInput(block.input), String(block.name)));
            }
          }
        } else if (msg.type === "result") {
          if (typeof msg.result === "string") text = msg.result;
          if (typeof msg.total_cost_usd === "number") costUsd = msg.total_cost_usd;
          if (msg.is_error) emit(makeEvent("error", String(msg.result ?? "agent reported an error")));
        }
      },
    });

    if (!text) {
      // Fall back to concatenated assistant text if no result event arrived.
      text = events.filter((e) => e.kind === "text").map((e) => e.text).join("\n");
    }
    if (res.code !== 0 && !text) {
      throw new Error(`claude exited ${res.code}: ${res.stderr.slice(-800)}`);
    }

    emit(makeEvent("result", text));
    return { provider: "claude", text, events, durationMs: Date.now() - started, costUsd, sessionId };
  },
};

function summarizeInput(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const o = input as Record<string, unknown>;
  const first = o.command ?? o.file_path ?? o.pattern ?? o.path ?? o.description;
  const s = typeof first === "string" ? first : JSON.stringify(o);
  return s.length > 200 ? `${s.slice(0, 200)}…` : s;
}
