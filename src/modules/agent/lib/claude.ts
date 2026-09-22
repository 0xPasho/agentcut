import { harnessBinary, spawnable } from "../server/binary";
import { spawnStream, makeEvent } from "../server/spawn";
import { describeAgentToolInput } from "../../project/lib/activity";
import type { AgentEvent, AgentProvider, AgentResult, AgentRunOptions } from "../types";

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
    return harnessBinary("claude") !== null;
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
    // --allowed-tools only widens; under `dontAsk` everything else is auto-approved
    // too. Denying is the only thing that actually removes a tool from the session.
    if (opts.deniedTools?.length) args.push("--disallowed-tools", opts.deniedTools.join(" "));
    if (opts.model) args.push("--model", opts.model);

    let text = "";
    let costUsd: number | undefined;
    let sessionId: string | undefined;

    const res = await spawnStream(spawnable("claude"), args, {
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
              emit(makeEvent("tool", describeAgentToolInput(block.input, opts.cwd), String(block.name)));
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
